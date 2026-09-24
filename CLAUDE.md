# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`packageManager: pnpm@10.9.0`). All tasks run through Nx.

```sh
# Whole workspace
pnpm build          # nx run-many --target=build --all
pnpm test           # nx run-many --target=test --all
pnpm lint           # nx run-many --target=lint --all
pnpm type-check      # nx run-many --target=type-check --all

# Per-app (bff, invoice, product) — same pattern for each
pnpm invoice:dev     # nx serve invoice
pnpm invoice:build   # nx build invoice
pnpm invoice:test    # nx test invoice
pnpm invoice:lint    # nx lint invoice

# Single test file / single test name
nx test invoice -- invoice.service.spec.ts
nx test invoice -- -t "creates an invoice"

# e2e (invoice-e2e, bff-e2e) — requires the target service's DB deps running
docker compose -f docker-compose.dev.yml up -d redis mongodb postgres
nx e2e invoice-e2e
```

Test/build/lint targets on every app and most libs are **inferred by Nx** from the presence of `jest.config.cts` / eslint config / `webpack.config.js` (see the `plugins` block in `nx.json`), not hand-written per project. A lib with no `jest.config.cts` has no `test` target at all — copy an existing lib's (e.g. `libs/transports`) `jest.config.cts` + `tsconfig.spec.json` + the `tsconfig.spec.json` reference in `tsconfig.json` when adding tests to a lib that doesn't have them yet.

### Docker Compose

- Dev: `cp .env.dev.example .env.dev && docker compose -f docker-compose.dev.yml up --build` — mounts the full workspace into containers, runs `pnpm nx serve <app>`, exposes Postgres/Mongo/Redis/pgAdmin to the host.
- Prod: `cp .env.prod.example .env.prod && docker compose -f docker-compose.prod.yml up -d --build` — multi-stage build via the root `Dockerfile` (`ARG APP_NAME` selects which app to build/run), internal-only `backend` network, no host port publishing for internal services.

### Commit messages

Conventional Commits, enforced by commitlint + husky pre-commit hook (which also runs lint-staged + a full `nx lint` across the workspace — expect it to be slow). Format: `<type>[optional scope]: <description>`, types: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`.

## Architecture

Nx monorepo. Three deployable apps in `apps/`, all sharing infrastructure libs under `libs/*` via TypeScript path aliases (`@libs/<name>`, mapped in `tsconfig.base.json`).

- **`apps/bff`** — public-facing API gateway. Owns Swagger, rate limiting, response envelopes, circuit breakers. Talks to `apps/invoice` only over TCP (via `@nestjs/microservices` `ClientProxy`), never touches Mongo/Postgres directly.
- **`apps/invoice`** — the actual invoice microservice. Exposes the same CRUD both as local HTTP (`invoice-http.controller.ts`, for direct/internal use) and as TCP `@MessagePattern`s (`invoice-rpc.controller.ts`, for the BFF). Owns the Mongo connection and all invoice persistence.
- **`apps/product`** — scaffolded but infrastructure-only (no domain logic yet as of this writing): logging/config wiring and Nx/Docker parity with `invoice`, nothing else.

Each of `bff`/`invoice`/`product` has an `*-e2e` sibling project that hits the real running app over HTTP (not mocked) — these need the app served (`nx serve <app>`) and its DB/cache dependencies up first; they're not run as part of the default `nx test` target.

### Gateway → microservice RPC pattern

The BFF never imports invoice's Nest module. Instead each gateway feature module (e.g. `apps/bff/src/app/modules/invoice/`) has its own `*-client.service.ts` extending `@libs/transports`'s `BaseTcpClient`, which wraps `ClientProxy.send()` with: an `RpcEnvelope` (correlation/trace id propagation, see `libs/transports/src/lib/rpc-envelope.ts`), a timeout, and HTTP-exception mapping (`GrpcToHttpMapper`/`ConnectionErrorDetector` translate RPC failures into the right `HttpException`, including `ServiceUnavailableException` when the invoice service is down). The BFF's own service layer then wraps that client with caching (`CACHE_MANAGER` + a Redis-backed list-version counter for cache invalidation) and an optional circuit breaker (`@libs/circuit-breaker`) that falls back to serving stale cached data when open. `TCP_PATTERNS`/`TCP_CLIENT_TOKENS`/`ServiceName` in `@libs/transports` are the single source of truth for which pattern strings and DI tokens exist per service — add new RPC endpoints there first.

### Shared libs (`libs/*`)

- `@libs/configuration` — process-wide config singletons (not NestJS `ConfigService` DI in most places; each app's `src/configuration/index.ts` calls `loadEnvironmentFiles()` then constructs and validates a `Configuration` instance eagerly at module load time, exported as `CONFIGURATION`). Several app-level providers read this singleton directly rather than injecting a config token — see the note on `MongoDbModule` below for why that matters.
- `@libs/schemas` — the only place Mongoose `@Schema()` classes live (`Invoice`, `InvoiceItem`, `ClientSnapshot`, `AuditLog`). `BaseSchema`/`BASE_SCHEMA_OPTIONS` set `versionKey: 'version'` and `optimisticConcurrency: true` (required for Mongoose to bump `version` on a plain `.set()+.save()`, not just on array mutations — needed for the If-Match optimistic-concurrency flow). The `Invoice` schema's `pre('validate')` hook is what (re)computes `subtotal`/`vatTotal`/`total` server-side; it always runs, so the client-submitted totals in a request body are ignored.
- `@libs/transports` — RPC plumbing described above, plus `TCP_PATTERNS`, `ServiceName`, `TCP_CLIENT_TOKENS`, `createTcpServerConfig`/`createTcpClientConfig`.
- `@libs/cache`, `@libs/circuit-breaker`, `@libs/rate-limit` — each is a `forRoot()`/`forRootAsync`-style Nest module wrapping the respective concern; only the BFF uses rate-limit and circuit-breaker, both `bff` and `invoice` use cache.
- `@libs/audit-log` — `AuditLogModule` (global) + `AuditLogService.record()`, backed by its own Mongo collection via `@InjectModel`. Import it directly with `MongooseModule.forFeature([...])` for the model it needs rather than assuming another module's global registration will provide it — see the gotcha below.
- `@libs/logging`, `@libs/middlewares`, `@libs/interceptors`, `@libs/filters`, `@libs/decorators` — pino-based structured logging (`LoggingModule.forRoot({ serviceName })`), correlation-id propagation, response envelope/timeout/RPC interceptors, the global exception filter.
- `@libs/interfaces` (imported as `@libs/interfaces/gateway`) and `@libs/shared/types` — request/response DTOs and shared domain types/enums/pagination helpers used by both `apps/bff` and `apps/invoice` so the two sides of the RPC boundary can't drift.

### Per-app database wiring (`apps/invoice/src/database/`)

Each app that owns a database wires its own `MongoDbModule` (not shared — it's app-local because each app can have different read-replica needs, see `MongoDbModule.withReadReplicas()`). A dynamic module's `imports` (e.g. `MongooseModule.forRootAsync({ inject: [...] })`) can only resolve providers declared in that _same_ module's own `providers` array or in modules _it_ imports — never a provider declared only by whatever module imports it. Read the app's own `CONFIGURATION` singleton directly in these low-level provider factories instead of injecting an app-level DI token for it.

### Nx per-app project parity

`apps/invoice/project.json` is the reference shape for a deployable app: `build`, `prune-lockfile`, `copy-workspace-modules`, `prune`, `serve`, `test` targets. The production `Dockerfile` runs `nx run ${APP_NAME}:build:production && nx run ${APP_NAME}:prune-lockfile` for whichever `APP_NAME` it's building — an app missing the `prune-lockfile`/`copy-workspace-modules`/`prune` targets will build fine locally via `nx serve`/`nx build` but fail the Docker image build. None of the apps have a per-app `package.json` (they rely on the root `package.json` + webpack's `generatePackageJson: true`) — don't add one when scaffolding a new app; copy the target definitions from `apps/invoice/project.json` instead.

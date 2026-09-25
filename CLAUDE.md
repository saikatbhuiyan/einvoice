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

# Per-app (bff, invoice, product, user-access) — same pattern for each
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

Nx monorepo. Four deployable apps in `apps/`, all sharing infrastructure libs under `libs/*` via TypeScript path aliases (`@libs/<name>`, mapped in `tsconfig.base.json`).

- **`apps/bff`** — public-facing API gateway. Owns Swagger, rate limiting, response envelopes, circuit breakers. Talks to `apps/invoice` only over TCP (via `@nestjs/microservices` `ClientProxy`), never touches Mongo/Postgres directly.
- **`apps/invoice`** — the actual invoice microservice. Exposes the same CRUD both as local HTTP (`invoice-http.controller.ts`, for direct/internal use) and as TCP `@MessagePattern`s (`invoice-rpc.controller.ts`, for the BFF). Owns the Mongo connection and all invoice persistence.
- **`apps/product`** — product catalog microservice, following the same dual-transport pattern as `invoice`: local HTTP (`product-http.controller.ts`) and TCP `@MessagePattern`s (`product-rpc.controller.ts`) over the same `ProductService`. Unlike `invoice` (MongoDB), it owns a **Postgres** connection via TypeORM (`src/database/postgres.module.ts`, `src/database/entities/product.entity.ts`) — the first real consumer of the `postgres` container the compose files already provisioned. Currently exposes create + list only. Schema is managed entirely by migrations (`src/database/migrations/`, run via `pnpm product:migration:run`) — `synchronize` is always off, in dev too; see `apps/product/README.md` for the full migration workflow, including why `src/database/data-source.ts` (the CLI's entry point) deliberately avoids `@libs/*` aliases and the app's `CONFIGURATION` singleton.

- **`apps/user-access`** — identity/access data microservice, same dual-transport shape again (`role-http.controller.ts`/`role-rpc.controller.ts`, `user-http.controller.ts`/`user-rpc.controller.ts`). Also owns Postgres via TypeORM, sharing the same database/instance as `product` (separate tables, separate migrations directory, same connection). Two modules: `RoleModule` (read-only — roles are managed by seeding, not an API; `pnpm nx run user-access:seed-roles` upserts `src/database/seeds/roles.seed.json` by `name`, safe to re-run) and `UserModule` (full CRUD: create/list/get/update/deactivate, deactivate being a soft `isActive: false` rather than a delete). `UserEntity` has **no password field** — credential storage is deliberately out of scope until an identity provider is introduced (see `docs/introducing-keycloak.md`). A `ManyToOne(..., { eager: true })` relation from `UserEntity` to `RoleEntity` bit us during development: eager relations only auto-join on `repository.find()`/`findOne()`, not on `createQueryBuilder()` (needs an explicit `.leftJoinAndSelect()`) or on the entity `save()` returns (needs a re-fetch) — see `UserRepository` for both fixes, and note `update()`/`deactivate()` use a direct `repository.update(id, partial)` rather than load+merge+save specifically because saving an entity with an already-loaded (and by-then-stale) relation object silently overwrites the join column you just tried to change.

Each of `bff`/`invoice`/`product` has an `*-e2e` sibling project that hits the real running app over HTTP (not mocked) — these need the app served (`nx serve <app>`) and its DB/cache dependencies up first; they're not run as part of the default `nx test` target.

### Gateway → microservice RPC pattern

The BFF never imports invoice's Nest module. Instead each gateway feature module (e.g. `apps/bff/src/app/modules/invoice/`) has its own `*-client.service.ts` extending `@libs/transports`'s `BaseTcpClient`, which wraps `ClientProxy.send()` with: an `RpcEnvelope` (correlation/trace id propagation, see `libs/transports/src/lib/rpc-envelope.ts`), a timeout, and HTTP-exception mapping (`GrpcToHttpMapper`/`ConnectionErrorDetector` translate RPC failures into the right `HttpException`, including `ServiceUnavailableException` when the invoice service is down). The BFF's own service layer then wraps that client with caching (`CACHE_MANAGER` + a Redis-backed list-version counter for cache invalidation) and an optional circuit breaker (`@libs/circuit-breaker`) that falls back to serving stale cached data when open. `TCP_PATTERNS`/`TCP_CLIENT_TOKENS`/`ServiceName` in `@libs/transports` are the single source of truth for which pattern strings and DI tokens exist per service — add new RPC endpoints there first.

### Shared libs (`libs/*`)

- `@libs/configuration` — process-wide config singletons (not NestJS `ConfigService` DI in most places; each app's `src/configuration/index.ts` calls `loadEnvironmentFiles()` then constructs and validates a `Configuration` instance eagerly at module load time, exported as `CONFIGURATION`). Several app-level providers read this singleton directly rather than injecting a config token — see the note on `MongoDbModule` below for why that matters.
- `@libs/schemas` — the only place Mongoose `@Schema()` classes live (`Invoice`, `InvoiceItem`, `ClientSnapshot`, `AuditLog`), used by `apps/invoice`. `BaseSchema`/`BASE_SCHEMA_OPTIONS` set `versionKey: 'version'` and `optimisticConcurrency: true` (required for Mongoose to bump `version` on a plain `.set()+.save()`, not just on array mutations — needed for the If-Match optimistic-concurrency flow). The `Invoice` schema's `pre('validate')` hook is what (re)computes `subtotal`/`vatTotal`/`total` server-side; it always runs, so the client-submitted totals in a request body are ignored. `apps/product`'s TypeORM entities are app-local instead (`apps/product/src/database/entities/`), not in a shared lib — each app that owns a database wires its own entities/connection (see the note on `MongoDbModule`/`PostgresModule` below).
- `@libs/transports` — RPC plumbing described above, plus `TCP_PATTERNS`, `ServiceName`, `TCP_CLIENT_TOKENS`, `createTcpServerConfig`/`createTcpClientConfig`.
- `@libs/cache`, `@libs/circuit-breaker`, `@libs/rate-limit` — each is a `forRoot()`/`forRootAsync`-style Nest module wrapping the respective concern; only the BFF uses rate-limit and circuit-breaker, both `bff` and `invoice` use cache.
- `@libs/audit-log` — `AuditLogModule` (global) + `AuditLogService.record()`, backed by its own Mongo collection via `@InjectModel`. Import it directly with `MongooseModule.forFeature([...])` for the model it needs rather than assuming another module's global registration will provide it — see the gotcha below.
- `@libs/logging`, `@libs/middlewares`, `@libs/interceptors`, `@libs/filters`, `@libs/decorators` — pino-based structured logging (`LoggingModule.forRoot({ serviceName })`), correlation-id propagation, response envelope/timeout/RPC interceptors, the global exception filter.
- `@libs/interfaces` (imported as `@libs/interfaces/gateway`) and `@libs/shared/types` — request/response DTOs and shared domain types/enums/pagination helpers used by both `apps/bff` and `apps/invoice` so the two sides of the RPC boundary can't drift.

### Per-app database wiring (`apps/invoice/src/database/`, `apps/product/src/database/`, `apps/user-access/src/database/`)

Each app that owns a database wires its own database module (not shared — `invoice`'s `MongoDbModule` is app-local because it can have different read-replica needs, see `MongoDbModule.withReadReplicas()`; `product` and `user-access`'s `PostgresModule`s follow the same shape for symmetry, even though they currently point at the same physical Postgres instance). A dynamic module's `imports` (e.g. `MongooseModule.forRootAsync({ inject: [...] })` / `TypeOrmModule.forRootAsync({ useFactory: ... })`) can only resolve providers declared in that _same_ module's own `providers` array or in modules _it_ imports — never a provider declared only by whatever module imports it. Read the app's own `CONFIGURATION` singleton directly in these low-level provider factories instead of injecting an app-level DI token for it. Each feature module that uses an entity/model registers it explicitly too (e.g. `TypeOrmModule.forFeature([...])` inside `ProductModule`, not only in the global `PostgresModule`) rather than relying on a `@Global()` module's registration reaching everywhere implicitly — that assumption is exactly what masked the real `AuditLogService` bug (a wrong injection token) behind what looked like a module-visibility problem.

### Nx per-app project parity

`apps/invoice/project.json` is the reference shape for a deployable app: `build`, `prune-lockfile`, `copy-workspace-modules`, `prune`, `serve`, `test` targets. The production `Dockerfile` runs `nx run ${APP_NAME}:build:production && nx run ${APP_NAME}:prune-lockfile` for whichever `APP_NAME` it's building — an app missing the `prune-lockfile`/`copy-workspace-modules`/`prune` targets will build fine locally via `nx serve`/`nx build` but fail the Docker image build. None of the apps have a per-app `package.json` (they rely on the root `package.json` + webpack's `generatePackageJson: true`) — don't add one when scaffolding a new app; copy the target definitions from `apps/invoice/project.json` instead. A Postgres-backed app additionally needs a `seed-*`-style custom target if it has seed data — see `apps/user-access/project.json`'s `seed-roles` target (an `nx:run-commands` executor invoking a ts-node script) for the pattern.

### `docs/`

Longer-form conceptual/design writeups that don't belong in code comments live here (e.g. `docs/auth-challenges-in-microservices.md`, `docs/introducing-keycloak.md`). Not API reference — that's Swagger, generated from the BFF controllers' decorators.

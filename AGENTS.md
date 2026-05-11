# AGENTS.md

## Project Overview

Nx monorepo with two NestJS apps communicating via TCP microservices:

- **`bff`** — public-facing BFF (Backend-For-Frontend). Exposes REST+Swagger, proxies to `invoice` over TCP. Port 3300.
- **`invoice`** — internal microservice. MongoDB persistence, TCP transport for inter-service calls, plus a separate HTTP port (3302) for health/debug. TCP port 3301.

Both apps use the same `@libs/configuration` pattern: a validated config class built from env vars at module-load time (`apps/<name>/src/configuration/index.ts`). Config is validated eagerly — missing/invalid env vars crash the app at startup with a clear error.

## Commands

```sh
pnpm nx serve bff            # Dev server for BFF
pnpm nx serve invoice        # Dev server for invoice
pnpm dev                     # Serve both apps in parallel
pnpm build                   # Build all
pnpm test                    # Run all unit tests
pnpm lint                    # Lint all
pnpm type-check              # TypeScript check all

# Single-project shortcuts exist (e.g.):
pnpm bff:dev                 # = nx serve bff
pnpm invoice:test            # = nx test invoice
```

Lint runs automatically on `git commit` via husky + lint-staged, then `nx run-many -t lint`.

## Environment Variables

Env files are loaded by `@libs/configuration/lib/env-loader.ts`:

1. `.env` (base, always loaded first)
2. `.env.<NODE_ENV>` (environment-specific, overrides base). Alias: `development` → also loads `.env.dev`

In production, env files are skipped — `ConfigModule.forRoot` sets `ignoreEnvFile: true`. All vars must come from the runtime environment.

Required env vars (see `.env.dev.example`): `NODE_ENV`, `GLOBAL_PREFIX`, `API_VERSION`, `CORS_ORIGINS`, `PORT`, `INVOICE_SERVICE_PORT`, `INVOICE_SERVICE_HOST`, `DATABASE_URL` (invoice only), `MONGODB_URI` + `MONGODB_DB_NAME` (invoice only).

## Architecture

```
apps/
  bff/          # BFF app — REST API, Swagger, TCP client
  bff-e2e/      # E2E tests for BFF (depends on bff:build + bff:serve)
  invoice/      # Invoice microservice — MongoDB, TCP server
  invoice-e2e/  # E2E tests for invoice
libs/
  configuration/ # BaseConfiguration, AppConfiguration, MongoDbConfiguration, env-loader
  constants/
  decorators/
  filters/       # GlobalExceptionFilter
  interceptors/  # ResponseInterceptor, RpcExceptionInterceptor, RpcLoggingInterceptor, TimeoutInterceptor
  interfaces/
  middlewares/   # LoggerMiddleware
  schemas/       # Mongoose schemas module
  shared/
    types/
    utils/
  transports/    # TCP server/client config, message patterns, ServiceName enum
```

### Inter-service Communication

- `bff` → `invoice`: TCP via `@nestjs/microservices` using `TCP_CLIENT_INVOICE` injection token
- Message patterns defined in `@libs/transports` (`INVOICE_PATTERNS`, `USER_PATTERNS`, etc.)
- `ServiceName` enum reserves slots for future services (USER, NOTIFICATION, PAYMENT)

### Import Aliases (tsconfig.base.json paths)

| Import path           | Source                            |
| --------------------- | --------------------------------- |
| `@libs/constants`     | `libs/constants/src/index.ts`     |
| `@libs/configuration` | `libs/configuration/src/index.ts` |
| `@libs/middlewares`   | `libs/middlewares/src/index.ts`   |
| `@libs/shared/types`  | `libs/shared/types/src/index.ts`  |
| `@libs/shared/utils`  | `libs/shared/utils/src/index.ts`  |
| `@libs/interceptors`  | `libs/interceptors/src/index.ts`  |
| `@libs/interfaces`    | `libs/interfaces/src/index.ts`    |
| `@libs/filters`       | `libs/filters/src/index.ts`       |
| `@libs/transports`    | `libs/transports/src/index.ts`    |
| `@libs/decorators`    | `libs/decorators/src/index.ts`    |
| `@libs/schemas`       | `libs/schemas/src/index.ts`       |

## Code Style & Conventions

- **Prettier**: single quotes, trailing commas, 120 char width, 2-space indent, semicolons
- **Commit messages**: Conventional Commits enforced via `commitlint` + husky (`type(scope): subject`). Scope uses kebab-case. Breaking changes require `!` suffix. Max header 120 chars, subject 100 chars.
- **TypeScript**: `experimentalDecorators` + `emitDecoratorMetadata` enabled. Target ES2015, module ESNext.
- **Validation**: DTOs use `class-validator` decorators; global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, `errorHttpStatusCode: 422`.
- **Config**: Use `class-validator` + `class-transformer` pattern — see `@libs/configuration`. Never read `process.env` directly in modules; inject via `ConfigService` or use the static `CONFIGURATION` object.

## Docker

- Dev: `docker compose -f docker-compose.dev.yml up --build` — mounts workspace, hot-reloads, exposes Postgres (5432) and MongoDB (27017) to host.
- Prod: `docker compose -f docker-compose.prod.yml up -d --build` — multi-stage build, `backend` network is internal-only.
- The `invoice` app has two ports: TCP (3301) for microservice traffic, HTTP (3302) for direct access. The `bff` only exposes HTTP (3300).

## Testing

- Unit tests: Jest per-project (`nx test <project>`). Nx caches results.
- E2E tests: Run via `nx e2e bff-e2e` / `nx e2e invoice-e2e`. These **depend on the app being built and served first**.
- Both app projects have `passWithNoTests: true` in their test config.

## Gotchas

- `invoice` uses **MongoDB** (via `@nestjs/mongoose`), not Postgres. Postgres (`DATABASE_URL`) is injected for future relational modules but not currently consumed.
- The `invoice` microservice listens on both TCP (microservice transport) and HTTP (separate port). The HTTP port is for health checks and direct debugging — it is not the primary API surface.
- Env loading happens at module-load time via `loadEnvironmentFiles()` (called in each app's `configuration/index.ts`). This must run before any `ConfigModule.forRoot()`.
- `.env` and `.env.dev` / `.env.prod` are gitignored. Copy from `.env.dev.example` / `.env.prod.example`.
- Several libs (`transports`, `schemas`, `decorators`, etc.) have no build targets defined — they are consumed as TypeScript source via Nx path aliases, not as compiled packages.

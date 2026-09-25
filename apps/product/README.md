# Product Service

NestJS microservice for the product catalog. Backed by Postgres via TypeORM, following the same dual-transport shape as `apps/invoice`: a local HTTP surface (`ProductHttpController`) and a TCP `@MessagePattern` surface (`ProductRpcController`) over the same `ProductService`, consumed by `apps/bff`'s gateway module. Currently exposes create + list; other operations aren't implemented yet.

## Running

```bash
pnpm product:migration:run   # apply pending migrations (required before first run)
pnpm product:dev             # nx serve product
pnpm product:build           # nx build product
pnpm product:test            # nx test product
```

Or as part of the dev docker-compose stack (runs pending migrations automatically before serving):

```bash
docker compose -f docker-compose.dev.yml up product
```

The HTTP surface listens on `PRODUCT_HTTP_PORT` (default `3303`), and the TCP microservice on `PRODUCT_SERVICE_PORT` (default `3304`), both configurable via `.env.dev`.

## Database & migrations

The schema is managed entirely by TypeORM migrations (`apps/product/src/database/migrations/`) — `synchronize` is always off, including in dev, so what's in a migration is what's actually deployed. `apps/product/src/database/data-source.ts` is a CLI-only `DataSource` (self-contained: plain `process.env` + `dotenv`, not the app's `CONFIGURATION` singleton or `@libs/*` path aliases, since the `typeorm` CLI's ts-node loader doesn't have the workspace's alias mapping or webpack bundling available to it).

```bash
pnpm product:migration:generate  # diff ProductEntity against the DB, write a new migration
pnpm product:migration:run       # apply pending migrations
pnpm product:migration:revert    # roll back the last applied migration
pnpm product:migration:show      # list migrations and their applied status
```

`migration:generate` needs a real Postgres connection to diff against (`POSTGRES_HOST`/`POSTGRES_PORT`/etc. from your environment) — point it at a disposable/dev database, not production. Always read a generated migration before committing it: TypeORM doesn't add `CREATE EXTENSION` statements for things like `uuid_generate_v4()` (used by `ProductEntity`'s `id` column) even though it relies on the `uuid-ossp` extension being enabled — the initial migration adds this explicitly, and later ones may need the same treatment if they introduce new database-level dependencies.

## Status

Real service, not a scaffold: Postgres connection (`PostgresModule`), `ProductEntity`/`ProductRepository`, `ProductService`, HTTP + TCP controllers, migrations, and full BFF gateway integration are all in place for create + list. Its Nx targets (`build`, `serve`, `test`, `prune-lockfile`, `copy-workspace-modules`, `prune`) mirror `apps/invoice`'s so the shared production Dockerfile can build it.

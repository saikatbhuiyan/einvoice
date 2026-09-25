# User Access Service

NestJS microservice for identity/access data: roles and users. Backed by Postgres via TypeORM,
following the same dual-transport shape as `apps/invoice` and `apps/product`: a local HTTP surface
and a TCP `@MessagePattern` surface over the same services, consumed by `apps/bff`'s gateway
module.

Two modules:

- **Roles** — read-only via the API (`GET /roles`). Roles are managed by seeding, not by a
  create/update/delete API — see [Seeding roles](#seeding-roles) below.
- **Users** — full management API: create, list (paginated, filterable by role/active status,
  free-text search), get, update (including reassigning a role), and deactivate (soft — sets
  `isActive: false`, never a hard delete).

`UserEntity` deliberately has no password field. Credential storage isn't this service's job — see
[`docs/introducing-keycloak.md`](../../docs/introducing-keycloak.md) at the repo root for why, and
what identity provider integration will eventually change here.

## Running

```bash
pnpm user-access:migration:run   # apply pending migrations (required before first run)
pnpm user-access:seed:roles      # seed roles.seed.json (safe to re-run)
pnpm user-access:dev             # nx serve user-access
pnpm user-access:build           # nx build user-access
pnpm user-access:test            # nx test user-access
```

Or as part of the dev docker-compose stack (runs migrations and seeds roles automatically before serving):

```bash
docker compose -f docker-compose.dev.yml up user-access
```

The HTTP surface listens on `USER_ACCESS_HTTP_PORT` (default `3305`), and the TCP microservice on
`USER_SERVICE_PORT` (default `3306`), both configurable via `.env.dev`. It shares the same Postgres
instance/database as `apps/product` (separate tables, separate migrations directory).

## Database & migrations

Schema is managed entirely by TypeORM migrations (`src/database/migrations/`) — `synchronize` is
always off, including in dev. `src/database/data-source.ts` is a CLI-only `DataSource`,
deliberately self-contained (plain `process.env` + `dotenv`, not the app's `CONFIGURATION`
singleton or `@libs/*` path aliases) — see `apps/product/README.md`'s migrations section for why
the `typeorm` CLI needs this.

```bash
pnpm user-access:migration:generate  # diff RoleEntity/UserEntity against the DB, write a migration
pnpm user-access:migration:run       # apply pending migrations
pnpm user-access:migration:revert    # roll back the last applied migration
pnpm user-access:migration:show      # list migrations and their applied status
```

As with `product`, always read a generated migration before committing it — TypeORM doesn't add
`CREATE EXTENSION` statements for `uuid_generate_v4()` even though the entities' `id` columns rely
on the `uuid-ossp` extension being enabled; the initial migration adds this explicitly.

## Seeding roles

`src/database/seeds/roles.seed.json` is the source of truth for which roles exist and what
permissions each one carries. `pnpm user-access:seed:roles` (an Nx target, `seed-roles`, using the
`nx:run-commands` executor — see `project.json`) reads that file and **upserts** each role by
`name`, so re-running it after editing the JSON updates existing roles' descriptions/permissions
without creating duplicates. To add a new role, add an entry to the JSON and re-run the seed — no
migration needed, since roles are data, not schema.

## Status

Real service: Postgres connection, `RoleEntity`/`UserEntity` with a `ManyToOne` relation between
them, full user CRUD (minus password/auth, deferred to a future identity-provider integration),
migrations, JSON-seeded role data, and full BFF gateway integration. Its Nx targets mirror
`apps/invoice`'s so the shared production Dockerfile can build it.

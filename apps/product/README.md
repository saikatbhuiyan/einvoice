# Product Service

NestJS microservice scaffold for product management. Currently initialized with logging (`nestjs-pino` via `LoggingModule.forRoot({ serviceName: 'product' })`), config, and graceful-shutdown wiring — no product domain logic (entities, endpoints, persistence) has been added yet.

## Running

```bash
pnpm product:dev          # nx serve product
pnpm product:build        # nx build product
pnpm product:test         # nx test product
```

Or as part of the dev docker-compose stack:

```bash
docker compose -f docker-compose.dev.yml up product
```

The service listens on `PRODUCT_HTTP_PORT` (default `3303`, configurable via `.env.dev`).

## Status

This app is infrastructure-only: it builds, serves, and runs in the docker-compose stack, and its Nx targets (`build`, `serve`, `test`, `prune-lockfile`, `copy-workspace-modules`, `prune`) mirror `apps/invoice`'s so the shared production Dockerfile can build it. Product domain modules (controllers, services, schemas, database wiring) are not implemented yet.

# einvoice

A multi-tenant invoicing platform built as an Nx monorepo of NestJS microservices, plus one Go service.

Organizations manage customers, products and invoices. Invoices are numbered per organization and can be issued as Bangladesh VAT (Mushak-6.3) tax invoices. Money is calculated exactly, with no floating-point totals. Each invoice is rendered to a private PDF and paid through Stripe or SSLCommerz. Overdue invoices trigger reminder emails.

## Architecture

```
                 ┌──────────────┐
  client ──────► │     bff      │  the only public API
                 └──────┬───────┘
          gRPC ┌────────┴─────────── TCP ───────────────────┐
               ▼                                            ▼
        ┌────────────┐   gRPC   ┌─────────────┐    ┌───────────────────────────────┐
        │ authorizer │ ───────► │ user-access │    │ invoice · product · payment   │
        └────────────┘          └─────────────┘    │ pdf-generator · media         │
                                                   └───────────────┬───────────────┘
                                                                   │ invoice.events (Kafka)
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │ services/mail   │  Go
                                                          └─────────────────┘
```

| Service | What it does | Talks over | Stores data in |
|---|---|---|---|
| `bff` | The only public API: Swagger, rate limits, circuit breakers, and the Stripe webhook | HTTP in, TCP and gRPC out | none |
| `authorizer` | Works out the caller's organization, role and permissions | gRPC | none |
| `user-access` | Organizations, memberships and roles, with users in Keycloak | gRPC and TCP | PostgreSQL |
| `invoice` | Invoice lifecycle, numbering, reminders and the outbox relay | TCP, Kafka producer | MongoDB |
| `product` | Catalog for invoice lines | TCP | PostgreSQL |
| `payment` | Stripe and SSLCommerz checkout and webhooks | TCP | PostgreSQL |
| `pdf-generator` | Renders invoices with EJS and headless Chromium | TCP | none |
| `media` | Stores PDFs in S3 under per-organization keys and signs download links | TCP | S3 |
| `services/mail` | Consumes invoice events and sends email through SMTP or Amazon SES | Kafka consumer | none |

Shared code lives in `libs/` (auth, cache, circuit breaker, money, saga, telemetry, transports and more), imported through `@libs/<name>` aliases.

## Design decisions worth reading

- **Transactional outbox.** `invoice` writes each event to an outbox collection in the same MongoDB transaction as the change it describes, so MongoDB runs as a replica set. One relay publishes the events to Kafka, keyed by invoice ID so each invoice's events stay in order.
- **One event contract, two languages.** The Go consumer can't import the TypeScript types, so golden fixtures in `libs/transports/src/contracts/kafka/` pin the exact wire format.
- **Sagas across stores.** MongoDB, PostgreSQL, Stripe, Keycloak and S3 share no transaction. `@libs/saga` runs steps in order and compensates the completed ones in reverse when a later step fails. A payment that can't be reconciled is flagged for review, not silently reverted.
- **Tenancy is enforced, not assumed.** Repositories throw if a request has no organization. Only system jobs, such as the overdue scan, read across organizations. The organization a request names is checked against the caller's memberships and never trusted on its own.
- **One scheduler at a time.** A Redis lease elects one instance to scan for overdue invoices. The lease is renewed before each invoice, so a crashed leader is replaced in about a minute.
- **Health checks that don't cascade.** `/ready` checks only a service's own dependencies. Peer checks are diagnostic, so one service's outage doesn't take its callers out of rotation.

## Running it locally

You need Node.js, pnpm and Docker.

```sh
pnpm install
cp .env.dev.example .env.dev
docker compose -f docker-compose.dev.yml up --build
```

Development email goes to Mailpit at http://127.0.0.1:8025.

To add logs, metrics and traces (Loki, Prometheus, Tempo and Grafana):

```sh
docker compose -f docker-compose.dev.yml -f docker-compose.observability.yml up -d
```

## Tests

| Layer | Command |
|---|---|
| Unit and transport | `pnpm test` |
| Integration, using Testcontainers for Redis, PostgreSQL, MongoDB and S3 | `pnpm integration` |
| End to end, against the running stack | `pnpm e2e` (bff), `nx e2e invoice-e2e` |
| Load, with k6 | `pnpm load:bff` |
| Go mail service | `pnpm mail:test` |

CI runs lint, type checks, unit, transport, contract and integration tests, plus `go vet` and `go test -race` for the mail service.

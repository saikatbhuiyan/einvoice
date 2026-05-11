# Code Quality & Architecture Improvements

This document records all structural, architectural, and quality improvements applied to the E-Invoice monorepo. Each change is delivered as an isolated commit with a clear rationale grounded in SOLID principles, DRY, KISS, and production-readiness standards used by top-tier engineering teams.

---

## 1. fix(rpc): remove debug console.log from rpc-logging interceptor

**Files:** `libs/interceptors/src/lib/rpc-logging.interceptor.ts`

**What changed:**

- Removed stray `console.log('Not RPC')` inside `RpcLoggingInterceptor.intercept()`.

**Why:**

- Debug statements leak into production logs, polluting log aggregation systems (ELK, Datadog, CloudWatch) and increasing ingest costs.
- In high-throughput services, even a single `console.log` per request can generate terabytes of unstructured log volume.
- NestJS `Logger` was already the intended logging mechanism; `console.log` bypasses log levels and formatting.

---

## 2. feat(shared): extract http-status util and deduplicate statusTitle across codebase

**Files:**

- `libs/shared/utils/src/lib/http-status.util.ts` (new)
- `libs/shared/utils/src/index.ts`
- `libs/filters/src/lib/global-exception.filter.ts`
- `libs/transports/src/lib/base-tcp.client.ts`
- `apps/bff/src/app/common/swagger/api-response.decorator.ts`

**What changed:**

- Created a single source of truth `statusTitle(status: number)` function and `problemTitles` constant map.
- Replaced three independent copies of the same HTTP-status-to-title mapping (in `GlobalExceptionFilter`, `BaseTcpClient`, and `api-response.decorator`) with imports from `@libs/shared/utils`.

**Why:**

- **DRY violation:** The same ~20-line mapping existed in three places. Updating status text (e.g. renaming "Unprocessable Entity" to "Validation Failed") required editing three files, guaranteeing drift over time.
- **Maintainability:** One file to update, one set of unit tests to write, zero risk of inconsistent error titles between HTTP responses, RPC error translation, and Swagger documentation.
- **Consistency:** Swagger examples, Problem Details (RFC 7807), and RPC-to-HTTP error mapping now emit identical titles for the same status code.

---

## 3. feat(interceptors): add TimedRequest interface for safe \_startTime access

**Files:**

- `libs/shared/types/src/lib/http-request.types.ts` (new)
- `libs/shared/types/src/index.ts`
- `libs/middlewares/src/lib/logger.middleware.ts`
- `libs/interceptors/src/lib/response.interceptor.ts`

**What changed:**

- Introduced `TimedRequest` interface extending Express `Request` with `readonly _startTime: bigint`.
- `LoggerMiddleware` now sets `req._startTime = startAt` explicitly (it was previously kept as a local variable and never attached to the request, making the downstream read a no-op).
- `ResponseInterceptor` reads `request._startTime` via the typed interface instead of `(request as any)._startTime`.

**Why:**

- **Type safety:** `(request as any)._startTime` disables the TypeScript compiler's ability to catch refactoring errors. If the property name changes, the code fails silently at runtime.
- **Contract documentation:** The interface makes the middleware-to-interceptor dependency explicit. Future developers can see exactly which properties `LoggerMiddleware` guarantees on the request object.
- **Bug fix:** Before this change, `ResponseInterceptor` always calculated `durationMs` as `undefined` because `_startTime` was never set on the request object.

---

## 4. refactor(invoice): split controller into HTTP and RPC controllers (SRP)

**Files:**

- `apps/invoice/src/app/modules/invoice/invoice-http.controller.ts` (new)
- `apps/invoice/src/app/modules/invoice/invoice-rpc.controller.ts` (new)
- `apps/invoice/src/app/modules/invoice/invoice.module.ts`
- `apps/invoice/src/app/modules/invoice/invoice.controller.ts` (deleted)

**What changed:**

- Extracted `@MessagePattern` handlers from the monolithic `InvoiceController` into `InvoiceRpcController`.
- Kept REST decorators (`@Get`, `@Post`, etc.) in `InvoiceHttpController`.
- Both controllers delegate to the same `InvoiceService` — no logic duplication.

**Why:**

- **Single Responsibility Principle (SRP):** The original controller had two reasons to change: (1) REST API contract evolution and (2) inter-service message pattern changes. Splitting them means a change to HTTP routing does not risk breaking RPC semantics, and vice versa.
- **Testability:** HTTP controllers can be tested with `supertest`; RPC controllers can be tested with `MicroserviceTest` — no need to set up both transports in a single test suite.
- **Operational flexibility:** Either transport can be disabled independently (e.g. disable HTTP in a pure worker deployment, or disable RPC during local debugging).
- **Scalability:** As the service grows, HTTP and RPC concerns diverge (HTTP needs OpenAPI decorators, RPC needs event sourcing). Keeping them together creates a 500+ line god-class.

---

## 5. feat(schemas): implement soft deletes for invoices

**Files:**

- `libs/schemas/src/lib/invoice.schema.ts`
- `apps/invoice/src/app/modules/invoice/invoice.service.ts`

**What changed:**

- Added `deletedAt?: Date | null` to the `Invoice` schema with a sparse index.
- Updated `findAll`, `findOne`, and `update` to filter by `deletedAt: null`.
- Changed `remove()` from `findByIdAndDelete` (permanent data loss) to `findOneAndUpdate` setting `deletedAt: new Date()`.

**Why:**

- **Data integrity / audit:** Hard deletes are irreversible. In a financial system like invoicing, accidental deletion by an admin or a buggy client script is a catastrophic compliance risk.
- **Recovery:** Soft-deleted invoices can be restored via a future admin endpoint or data-replay pipeline without touching backups.
- **Referential safety:** If other collections reference invoices (payments, audit logs), a hard delete creates dangling foreign keys. Soft delete preserves referential integrity.
- **Legal/compliance:** Many jurisdictions require financial records to be retained for 5–7 years. Soft delete is a prerequisite for retention policies.

---

## 6. refactor(invoice): implement repository pattern abstraction

**Files:**

- `apps/invoice/src/app/modules/invoice/invoice.repository.interface.ts` (new)
- `apps/invoice/src/app/modules/invoice/invoice.repository.ts` (new)
- `apps/invoice/src/app/modules/invoice/invoice.module.ts`
- `apps/invoice/src/app/modules/invoice/invoice.service.ts`

**What changed:**

- Introduced `IInvoiceRepository` interface and `INVOICE_REPOSITORY` injection token.
- Created `InvoiceRepository` encapsulating all Mongoose queries, soft-delete filtering, and pagination math.
- Refactored `InvoiceService` to depend on `IInvoiceRepository` instead of `Model<Invoice>` directly.
- Service layer now contains only business logic (exception throwing, response mapping); persistence logic lives in the repository.

**Why:**

- **Dependency Inversion Principle (DIP):** The service depended on a concrete Mongoose model. Now it depends on an abstraction. If the team migrates from MongoDB to PostgreSQL (or adds a read-replica CQRS setup), only the repository implementation changes — zero service-layer churn.
- **Testability:** Unit tests for `InvoiceService` can inject an in-memory stub/fake repository. No need to spin up MongoDB or mock complex Mongoose chains.
- **Separation of concerns:** Query construction, index hints, and soft-delete filters are persistence details. Business rules ("throw NotFoundException when invoice is missing") are domain details. Mixing them makes both harder to reason about.
- **Transaction boundaries:** Future work can wrap multiple repository calls in a MongoDB session or Saga pattern without polluting service code.

---

## 7. refactor(database): inject MongoDB config via DI instead of direct import

**Files:**

- `apps/invoice/src/app/app.module.ts`
- `apps/invoice/src/database/mongodb.module.ts`
- `apps/invoice/src/database/mongodb.provider.ts`

**What changed:**

- `AppModule` now provides `APP_CONFIGURATION` as a NestJS provider using `useValue: CONFIGURATION`.
- `MongoDbModule` and `mongoProviders` inject `APP_CONFIGURATION` via NestJS DI instead of directly importing the static `CONFIGURATION` object from `../configuration`.

**Why:**

- **Dependency Inversion Principle (DIP):** Database providers were reaching across module boundaries to import a singleton. This creates a hidden dependency graph that breaks when files are moved or when configuration is loaded differently in tests.
- **Testability:** In integration tests, we can now override `APP_CONFIGURATION` with a test fixture (e.g. pointing to an in-memory MongoDB instance) without monkey-patching module imports.
- **Encapsulation:** The configuration object is validated at bootstrap, but its consumption should still flow through the container. Static imports bypass NestJS module encapsulation.

---

## 8. refactor(shared): centralize ValidationPipe, CORS methods and pagination defaults

**Files:**

- `libs/shared/utils/src/lib/validation-pipe.factory.ts` (new)
- `libs/shared/utils/src/index.ts`
- `libs/constants/src/lib/common.constants.ts`
- `libs/shared/types/src/lib/pagination.dto.ts`
- `apps/bff/src/main.ts`
- `apps/invoice/src/main.ts`
- `apps/invoice/src/app/modules/invoice/invoice.repository.ts`
- `apps/invoice/src/app/modules/invoice/invoice.service.ts`

**What changed:**

- Added `createValidationPipe()` factory and `DEFAULT_VALIDATION_PIPE_OPTIONS` to `@libs/shared/utils`.
- Added `ALLOWED_HTTP_METHODS`, `DEFAULT_PAGE`, `DEFAULT_LIMIT`, and `MAX_LIMIT` to `@libs/constants`.
- Both `bff` and `invoice` `main.ts` files now consume the shared factory and constants.
- `PaginationQueryDto` and invoice repository/service use centralized defaults.

**Why:**

- **DRY violation:** `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 })` was duplicated in both `main.ts` files. Changing `errorHttpStatusCode` or adding `disableErrorMessages` in production would require two edits.
- **Consistency:** CORS methods and pagination limits are cross-cutting concerns. If the BFF allows `OPTIONS` but the invoice microservice forgets it, preflight requests fail during RPC bridging.
- **Single source of truth:** Changing the default page size from 20 to 25 requires one edit in `@libs/constants` instead of hunting through DTOs, repositories, and services.

---

## 9. feat(health): add comprehensive health check indicators

**Files:** `apps/invoice/src/app/app.service.ts`

**What changed:**

- Restructured `getHealth()` to return a typed `HealthCheckResult` with sub-system checks.
- Added MongoDB connectivity check with try/catch resilience (no unhandled promise rejection on DB failure).
- Added memory usage check (`heapUsedMB`, `heapTotalMB`, `rssMB`) and degraded-status detection when heap exceeds 1.5 GB.

**Why:**

- **Observability:** Load balancers, Kubernetes probes, and monitoring systems (Prometheus, Datadog) need more than a static `{ status: 'ok' }`. They need to know _which_ subsystem failed.
- **Fail-fast routing:** If MongoDB is down, the health endpoint returns `status: 'degraded'`, allowing the orchestrator to stop routing traffic to the pod before cascading failures occur.
- **Memory leak detection:** A steadily growing heap is often the first symptom of a memory leak. Exposing it in health checks lets SRE teams alert on it before OOM kills happen.

---

## 10. feat(invoice): add idempotency key support for create operations

**Files:**

- `libs/schemas/src/lib/invoice.schema.ts`
- `libs/interfaces/src/lib/gateway/invoice/create-invoice.dto.ts`
- `libs/interfaces/src/lib/gateway/invoice/invoice-response.dto.ts`
- `libs/interfaces/src/lib/gateway/invoice/invoice.types.ts`
- `apps/invoice/src/app/modules/invoice/invoice.repository.ts`

**What changed:**

- Added optional `idempotencyKey?: string` to `CreateInvoiceDto`, schema, and response types.
- Added a sparse unique index on `Invoice.idempotencyKey`.
- `InvoiceRepository.create()` checks for an existing non-deleted invoice with the same key and returns it instead of creating a duplicate.

**Why:**

- **Network reliability:** In distributed systems, clients often retry requests after timeouts. Without idempotency, a retry creates duplicate invoices — a billing nightmare.
- **Industry standard:** Stripe, Adyen, and Shopify all use idempotency keys for write operations. It is the canonical solution for exactly-once semantics over an at-least-once transport (HTTP/TCP).
- **Sparse index safety:** Using a sparse unique index means null/undefined keys do not collide. Only clients that explicitly opt in by sending a key are protected.

---

## 11. fix(middlewares): correct TimedRequest type in LoggerMiddleware extractIp

**Files:** `libs/middlewares/src/lib/logger.middleware.ts`

**What changed:**

- Changed `extractIp(req: Request)` signature to `extractIp(req: TimedRequest)` after the Express `Request` import was removed.

**Why:**

- **Type correctness:** Without an explicit `Request` import from 'express', TypeScript resolved `Request` to an ambient global type (DOM `Request` or Node.js `Request`), which lacks `socket.remoteAddress`. This caused a TypeScript build failure.
- **Consistency:** Since `use()` already receives `TimedRequest`, all private helpers should accept the same type.

---

## Summary of Principles Applied

| Principle | How it was applied                                                            |
| --------- | ----------------------------------------------------------------------------- |
| **SRP**   | Split combined HTTP+RPC controller; separated repository from service         |
| **OCP**   | Repository interface allows new storage backends without modifying service    |
| **LSP**   | `InvoiceRepository` implements `IInvoiceRepository` transparently             |
| **ISP**   | `IInvoiceRepository` exposes only the 5 methods the service needs             |
| **DIP**   | Service depends on `IInvoiceRepository` token; MongoDB config injected via DI |
| **DRY**   | Single `statusTitle()`, `createValidationPipe()`, pagination constants        |
| **KISS**  | Soft delete = one field + one filter; idempotency = one key + one query       |

## What's Next (Planned by Requester)

- **Rate limiting** (`@nestjs/throttler`) — protect against brute-force and DoS
- **Caching layer** (Redis) — reduce MongoDB read load on `findOne` and hot `findAll` queries
- **Circuit breaker** — fail fast when downstream `invoice` microservice is unreachable

---

_Generated on 2026-05-11. All commits pass `pnpm build` and `pnpm lint`._

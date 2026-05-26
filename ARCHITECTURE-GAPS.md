# Architecture Gaps — Road to 10/10

This document tracks the remaining gaps between the current codebase and a **10/10 production-grade system** as practiced at Google, Stripe, Netflix, and Shopify.

**Current grade: 9/10** (A-grade, production-ready, but not yet best-in-class)

---

## Gap 1: Scalability Infrastructure (8/10 → 10/10)

### Missing Features

| Feature               | Status      | Why It Matters                                                                                   | Effort |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------ | ------ |
| **Redis Caching**     | Planned     | Every `findOne` hits MongoDB. At 10k RPM, unnecessary read load. Cache hot invoices for 5-60s.   | Medium |
| **Rate Limiting**     | Planned     | Single malicious client can DoS the BFF. Need `@nestjs/throttler` with Redis store.              | Small  |
| **Circuit Breaker**   | Planned     | If `invoice` microservice is down, `bff` hangs until 10s RPC timeout. Cascading failure pattern. | Medium |
| **Cursor Pagination** | Not planned | `countDocuments()` does full collection scan at scale. Cursor-based (`_id > lastId`) is O(1).    | Medium |
| **Read Replicas**     | Not planned | All reads go to MongoDB primary. `readPreference: secondaryPreferred` for `findAll`.             | Small  |

### What 10/10 Looks Like

```ts
// BFF with circuit breaker + cache
@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceClient: InvoiceClientService,
    private readonly cache: RedisService,
    private readonly breaker: CircuitBreaker,
  ) {}

  async findOne(id: string): Promise<InvoiceResponse> {
    const cached = await this.cache.get(`invoice:${id}`);
    if (cached) return JSON.parse(cached);

    // Circuit breaker returns fallback if invoice service is unhealthy
    const invoice = await this.breaker.fire(() => this.invoiceClient.findOneInvoice(id));
    await this.cache.setex(`invoice:${id}`, 30, JSON.stringify(invoice));
    return invoice;
  }
}
```

---

## Gap 2: SOLID Violations (9/10 → 10/10)

### Violation A: Static Config Access in `main.ts` (DIP)

**Location:** `apps/bff/src/main.ts:18`, `apps/invoice/src/main.ts:9`

```ts
const { CONFIGURATION } = AppModule; // ❌ Service locator anti-pattern
```

**Fix:** Use `ConfigService` or create a `BootstrapConfig` provider injected into `main.ts`.

```ts
// 10/10 approach
const app = await NestFactory.create(AppModule);
const configService = app.get(ConfigService);
const port = configService.get('PORT');
```

### Violation B: Fat Interface on `InvoiceFieldsDto` (ISP)

**Location:** `libs/interfaces/src/lib/gateway/invoice/invoice-fields.dto.ts`

`CreateInvoiceDto` extends `InvoiceFieldsDto` which has `invoiceNumber!` (required). `UpdateInvoiceDto` uses `PartialType(InvoiceFieldsDto)` making it optional. The base class serves two masters.

**Fix:** Split into `CreateInvoiceFieldsDto` and `UpdateInvoiceFieldsDto` with no shared base, or use composition over inheritance.

### Violation C: BFF `InvoiceService` is a Pass-Through

**Location:** `apps/bff/src/app/modules/invoice/invoice.service.ts`

Every method is a 1:1 proxy to `InvoiceClientService`. At top-tier companies, the BFF layer does **response transformation**, **field filtering** (hide internal IDs from mobile), or **aggregation** (invoice + payment status).

**Fix:** Add value or remove the indirection and inject `InvoiceClientService` directly into the controller.

---

## Gap 3: Production Safeguards (9/10 → 10/10)

| Missing Feature            | Risk                                           | Top Company Standard                              |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| **Input Sanitization**     | XSS via `notes` field                          | `class-sanitizer` or DOMPurify on all text fields |
| **Request Size Limits**    | 100MB JSON upload → OOM kill                   | `body-parser` limit: 100kb                        |
| **Optimistic Locking**     | Two admins edit same invoice → last write wins | `version` field with `If-Match` header            |
| **Audit Trail**            | "Who changed total from 30k to 3k?"            | Event sourcing or audit log collection            |
| **Graceful Drain**         | SIGTERM kills in-flight requests               | 30s drain timeout before `app.close()`            |
| **API Versioning on DTOs** | Breaking change forces all clients to update   | `CreateInvoiceV1Dto`, `CreateInvoiceV2Dto`        |

### What 10/10 Looks Like

```ts
// Optimistic locking + audit trail
@Injectable()
export class InvoiceService {
  async update(id: string, dto: UpdateInvoiceDto, actor: Actor, ifMatch: number): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepository.findOne(id);
    if (invoice.version !== ifMatch) {
      throw new ConflictException('Invoice was modified by another user. Please refresh and retry.');
    }

    const updated = await this.invoiceRepository.update(id, { ...dto, version: invoice.version + 1 });
    await this.auditLog.record({
      action: 'INVOICE_UPDATED',
      entityId: id,
      actor,
      diff: generateDiff(invoice, updated),
    });
    return updated;
  }
}
```

---

## Gap 4: Clean Code Smells (9/10 → 10/10)

### Remaining `any` Casts

**Location:** `libs/interceptors/src/lib/rpc-logging.interceptor.ts` (7 instances)

```ts
if (typeof (rpcCtx as any).getTopic === 'function') { ... }
```

**Fix:** Define a `RpcContext` union type:

```ts
type RpcContext =
  | { getTopic(): string }
  | { getMessage(): { headers?: Record<string, unknown> } }
  | { getMetadata(): Map<string, string[]> };
```

### Magic Numbers in Examples

**Location:** `apps/bff/src/app/modules/invoice/invoice.controller.ts:76`

```ts
limit: 20,  // ❌ Should be DEFAULT_LIMIT from @libs/constants
```

### Controller Bloat

BFF `InvoiceController` is 233 lines, 70% Swagger example objects. Extract to `invoice.examples.ts`.

---

## Gap 5: DRY Micro-Divergence (9/10 → 10/10)

### `statusTitle()` vs `problemTitles`

`statusTitle` supports codes `400, 401, 403, 404, 405, 409, 410, 422, 429, 500, 502, 503, 504`.
`problemTitles` supports `400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504`.

**Fix:** Derive `problemTitles` from `statusTitleMap`:

```ts
const SUPPORTED_PROBLEM_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];
export const problemTitles = Object.fromEntries(
  Object.entries(statusTitleMap).filter(([code]) => SUPPORTED_PROBLEM_CODES.includes(Number(code))),
);
```

---

## Gap 6: KISS — Over-Engineered Component (9/10 → 10/10)

### `BaseTcpClient` is 200+ Lines

Handles: gRPC code mapping, connection error detection, timeout handling, status title resolution.

**Fix:** Split into 3 focused classes:

```ts
@Injectable()
class RpcTimeoutHandler {
  handle(pattern: string, timeoutMs: number): Observable<unknown>;
}

@Injectable()
class GrpcToHttpMapper {
  map(grpcCode: number): number;
}

@Injectable()
class ConnectionErrorDetector {
  isConnectionError(error: unknown): boolean;
}
```

---

## Priority Roadmap

### Phase 1: Infrastructure (Your Planned Work)

- [ ] Redis caching for `findOne` and hot `findAll`
- [ ] `@nestjs/throttler` on BFF endpoints
- [ ] Circuit breaker for downstream RPC calls

### Phase 2: SOLID & Clean Code

- [ ] Fix `main.ts` static config access (use `ConfigService`)
- [ ] Remove remaining `any` casts in `rpc-logging.interceptor.ts`
- [ ] Extract Swagger examples from BFF controller
- [ ] Split `InvoiceFieldsDto` into Create/Update specific DTOs

### Phase 3: Production Hardening

- [ ] Request body size limits (`body-parser` 100kb)
- [ ] Input sanitization (`class-sanitizer`)
- [ ] Optimistic locking (`version` field + `If-Match`)
- [ ] Graceful shutdown with drain timeout

### Phase 4: Enterprise Features

- [ ] Audit log / event sourcing
- [ ] DTO versioning for backward compatibility
- [ ] Cursor-based pagination
- [ ] Read replica routing

---

## Honest Assessment

**You're at 9/10 because the architecture is now solid.** Repository pattern, soft deletes, idempotency, health checks, proper DI — these are the hard parts, and you got them right.

**The last point is operational polish.** Most Fortune 500 codebases I've reviewed are worse than yours right now. The gaps above are what separate "good production code" from "Google-grade infrastructure."

**Estimated effort to 10/10:** 2-3 focused sprints (assuming 1 engineer)

---

_Document version: 2026-05-11_
_Last reviewed after commit: `docs: add CHANGES.md documenting all architectural improvements`_

---
name: einvoice-architecture
description: Use when making or reviewing changes in the einvoice NestJS monorepo involving the BFF, invoice service, repository boundaries, Mongo read/write routing, caching, optimistic locking, or audit logging.
---

# Einvoice Architecture

## Use this skill when

- changing `apps/bff` or `apps/invoice`
- touching invoice repository, service, controller, or DTO flows
- reviewing architecture docs against implementation
- modifying Mongo read/write model wiring
- changing cache invalidation, circuit breaker, optimistic locking, or audit logging behavior

## Core rules

1. The BFF talks to invoice over TCP; keep transport concerns out of controllers.
2. Repository interfaces are the seam between business logic and persistence.
3. Read paths should use read models; write paths should use write models.
4. The default Mongo connection must remain pinned to `primary`.
5. Cache invalidation after mutation is required; do not assume cache warming exists.
6. Optimistic locking uses the `version` field and `If-Match` header semantics.
7. Audit logging should remain best-effort and should not break request success paths.
8. When reviewing docs, prefer current code over old claims.

## Before editing

- Read the target module and its adjacent DTO, interface, and schema files
- Check whether the same concern already belongs in `libs/`
- Verify whether the change affects both BFF and invoice service

## When reviewing

- Look for stale architecture claims
- Check read/write consistency assumptions
- Check cache invalidation on mutations
- Check whether transport failures map to correct HTTP semantics
- Check whether new behavior is observable and testable

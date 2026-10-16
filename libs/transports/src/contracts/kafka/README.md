# Kafka contract fixtures (`invoice.events`)

Exact message values as they appear on the wire, shared by both sides of the TypeScript → Go
contract. They are not documentation; two test suites assert against them:

- **Producer** — `apps/invoice/src/app/modules/invoice/clients/invoice-events-producer.contract.spec.ts`
  drives the real `InvoiceEventsProducerService` and asserts its output equals each file.
- **Consumer** — `services/mail/internal/events/contract_test.go` decodes each file with the real
  `events.Decode` and asserts the typed fields.

Changing the event shape means changing a fixture, which fails whichever side wasn't updated.

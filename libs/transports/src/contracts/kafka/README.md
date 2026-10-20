# Kafka contract fixtures (`invoice.events`)

Exact message values as they appear on the wire, shared by both sides of the TypeScript → Go
contract. They are not documentation; two test suites assert against them:

- **Producer** — `apps/invoice/src/app/modules/invoice/clients/invoice-events-producer.contract.spec.ts`
  drives the real `InvoiceEventsProducerService` and asserts its output equals each file.
- **Consumer** — `services/mail/internal/events/contract_test.go` decodes each file with the real
  `events.Decode` and asserts the typed fields.

Changing the event shape means changing a fixture, which fails whichever side wasn't updated.

`invoice.pdf.generated.legacy.json` is **consumer-only**: nothing produces `invoice.pdf.generated`
any more (it was replaced by `invoice.sent`, same payload), but messages of that type can still be
on the topic within its retention window, so the Go consumer must keep decoding it. Delete the
fixture together with the Go alias once retention has passed.

`invoice.sent.pdf-url.legacy.json` is **consumer-only** too: `invoice.sent` messages produced before
PDFs became private carry a public `pdfUrl` (and no `eventId`) instead of `pdfKey`. The Go consumer
fetches those by URL and can't dedupe them. Delete it together with that fallback once retention has
passed.

Every current event carries `eventId` (the producer's outbox row id); consumers dedupe on it, and
`meta.organizationId` (the tenant the event happened in). The two legacy fixtures have neither:
they predate both. A consumer that acts on an event without an organization treats it as the
default organization's -- the only one that existed before tenancy (see payment's
InvoiceEventsController).

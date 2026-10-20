package events

import (
	"os"
	"path/filepath"
	"testing"
)

// Consumer half of the invoice.events contract. These fixtures are the exact wire values the
// TypeScript producer's contract spec asserts it emits
// (apps/invoice/.../invoice-events-producer.contract.spec.ts), so a shape change on either side
// fails one of the two suites. See libs/transports/src/contracts/kafka/README.md.
const fixtureDir = "../../../../libs/transports/src/contracts/kafka"

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatalf("read contract fixture %s: %v", name, err)
	}
	return raw
}

// The organization every current fixture's event happened in; legacy fixtures predate tenancy.
const contractOrganization = "0d5c2b9e-7a41-4c8e-9f12-3b6a8e4d7c10"

func wantMeta(t *testing.T, meta Meta, organizationID string) {
	t.Helper()
	want := Meta{
		CorrelationID: "corr-contract-1",
		TraceID:       "trace-contract-1",
		UserID:        "user-1",
		Roles:         []string{"accountant"},
		Permissions:   []string{"invoice:write"},
		SourceService: "invoice",
		Timestamp:     "2026-10-16T09:00:00.000Z",
	}
	if meta.CorrelationID != want.CorrelationID || meta.TraceID != want.TraceID || meta.UserID != want.UserID ||
		meta.SourceService != want.SourceService || meta.Timestamp != want.Timestamp || meta.OrganizationID != organizationID ||
		len(meta.Roles) != 1 || meta.Roles[0] != "accountant" || len(meta.Permissions) != 1 || meta.Permissions[0] != "invoice:write" {
		t.Fatalf("meta = %+v, want %+v", meta, want)
	}
}

func TestContractDemoEvent(t *testing.T) {
	event, meta, ok, err := Decode(readFixture(t, "invoice.demo.json"))
	if err != nil || !ok {
		t.Fatalf("Decode: ok=%v err=%v", ok, err)
	}

	demo, isDemo := event.(DemoEvent)
	if !isDemo {
		t.Fatalf("event type = %T, want DemoEvent", event)
	}
	if demo.InvoiceID != "6700000000000000000000a1" || demo.Message != "Invoice 6700000000000000000000a1 was created." ||
		demo.EventID != "6710000000000000000000e1" {
		t.Fatalf("demo = %+v", demo)
	}
	wantMeta(t, meta, contractOrganization)
}

// The fields every invoice.sent fixture shares; each test adds what differs (eventId, pdfKey/pdfUrl).
func baseSentEvent(eventType string) SentEvent {
	return SentEvent{
		Type:          eventType,
		InvoiceID:     "6700000000000000000000a1",
		InvoiceNumber: "INV-2026-001",
		ClientName:    "Acme Corp",
		ClientEmail:   "billing@acme.test",
		FileName:      "invoice-INV-2026-001.pdf",
		Currency:      "EUR",
		Total:         129.9,
		IssueDate:     "2026-10-01T00:00:00.000Z",
		DueDate:       "2026-10-31T00:00:00.000Z",
	}
}

func decodeSent(t *testing.T, name string) (SentEvent, Meta) {
	t.Helper()
	event, meta, ok, err := Decode(readFixture(t, name))
	if err != nil || !ok {
		t.Fatalf("Decode(%s): ok=%v err=%v", name, ok, err)
	}
	got, isSent := event.(SentEvent)
	if !isSent {
		t.Fatalf("event type = %T, want SentEvent", event)
	}
	return got, meta
}

func TestContractSentEvent(t *testing.T) {
	got, meta := decodeSent(t, "invoice.sent.json")

	want := baseSentEvent(TypeSent)
	want.EventID = "6710000000000000000000e2"
	want.PdfKey = "invoices/2b6f0c2e-1c3a-4e3b-9a51-0d2f7b6c9e10/invoice-INV-2026-001.pdf"
	if got != want {
		t.Fatalf("event =\n %+v\nwant\n %+v", got, want)
	}
	wantMeta(t, meta, contractOrganization)
}

// The producer drops dueDate entirely (JSON.stringify omits undefined); it must decode as empty.
func TestContractSentWithoutDueDate(t *testing.T) {
	got, _ := decodeSent(t, "invoice.sent.no-due-date.json")

	if got.DueDate != "" || got.Total != 10 || got.Currency != "USD" || got.EventID != "6710000000000000000000e3" ||
		got.PdfKey != "invoices/7c1d9a40-5e2f-4b8a-8f63-3a9e0b1d2c45/invoice-INV-2026-002.pdf" {
		t.Fatalf("event = %+v", got)
	}
}

// Messages produced before PDFs became private: a public pdfUrl, no pdfKey, no eventId.
func TestContractLegacySentWithPdfUrlStillDecodes(t *testing.T) {
	got, meta := decodeSent(t, "invoice.sent.pdf-url.legacy.json")

	want := baseSentEvent(TypeSent)
	want.PdfURL = "https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1760605200000-invoice-INV-2026-001.pdf"
	if got != want {
		t.Fatalf("event =\n %+v\nwant\n %+v", got, want)
	}
	wantMeta(t, meta, "")
}

// Messages produced before the invoice.sent rename can still be on the topic: they must still be emailed.
func TestContractLegacyPdfGeneratedDecodesAsSent(t *testing.T) {
	got, meta := decodeSent(t, "invoice.pdf.generated.legacy.json")

	want := baseSentEvent(TypePdfGeneratedLegacy)
	want.PdfURL = "https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1760605200000-invoice-INV-2026-001.pdf"
	if got != want {
		t.Fatalf("event =\n %+v\nwant\n %+v", got, want)
	}
	wantMeta(t, meta, "")
}

// invoice.cancelled is payment's event: this service decodes the envelope (for logging) and reports
// it as not its own, which the handler acknowledges without acting.
func TestContractCancelledIsNotThisServicesEvent(t *testing.T) {
	event, meta, ok, err := Decode(readFixture(t, "invoice.cancelled.json"))

	if err != nil || ok || event != nil {
		t.Fatalf("Decode: event=%v ok=%v err=%v, want ignored", event, ok, err)
	}
	wantMeta(t, meta, contractOrganization)
}

// invoice.reminder is written by invoice's overdue scheduler: the system acted, so meta names the
// job (SystemActor) and carries no user.
func TestContractReminderEvent(t *testing.T) {
	event, meta, ok, err := Decode(readFixture(t, "invoice.reminder.json"))
	if err != nil || !ok {
		t.Fatalf("Decode: ok=%v err=%v", ok, err)
	}

	got, isReminder := event.(ReminderEvent)
	if !isReminder {
		t.Fatalf("event type = %T, want ReminderEvent", event)
	}
	want := ReminderEvent{
		Type:           TypeReminder,
		EventID:        "6710000000000000000000e5",
		InvoiceID:      "6700000000000000000000a1",
		InvoiceNumber:  "INV-2026-001",
		ClientName:     "Acme Corp",
		ClientEmail:    "billing@acme.test",
		PdfKey:         "invoices/2b6f0c2e-1c3a-4e3b-9a51-0d2f7b6c9e10/invoice-INV-2026-001.pdf",
		FileName:       "invoice-INV-2026-001.pdf",
		Currency:       "EUR",
		Total:          129.9,
		DueDate:        "2026-10-09T00:00:00.000Z",
		DaysOverdue:    7,
		ReminderNumber: 2,
	}
	if got != want {
		t.Fatalf("event =\n %+v\nwant\n %+v", got, want)
	}
	if meta.SystemActor != "overdue-job" || meta.UserID != "" || meta.OrganizationID != contractOrganization {
		t.Fatalf("meta = %+v, want the overdue job acting in %s with no user", meta, contractOrganization)
	}
}

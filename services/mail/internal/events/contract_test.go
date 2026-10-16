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

func wantMeta(t *testing.T, meta Meta) {
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
		meta.SourceService != want.SourceService || meta.Timestamp != want.Timestamp ||
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
	if demo.InvoiceID != "6700000000000000000000a1" || demo.Message != "Invoice 6700000000000000000000a1 was created." {
		t.Fatalf("demo = %+v", demo)
	}
	wantMeta(t, meta)
}

func TestContractPdfGeneratedEvent(t *testing.T) {
	event, meta, ok, err := Decode(readFixture(t, "invoice.pdf.generated.json"))
	if err != nil || !ok {
		t.Fatalf("Decode: ok=%v err=%v", ok, err)
	}

	got, isPdf := event.(PdfGeneratedEvent)
	if !isPdf {
		t.Fatalf("event type = %T, want PdfGeneratedEvent", event)
	}
	want := PdfGeneratedEvent{
		Type:          TypePdfGenerated,
		InvoiceID:     "6700000000000000000000a1",
		InvoiceNumber: "INV-2026-001",
		ClientName:    "Acme Corp",
		ClientEmail:   "billing@acme.test",
		PdfURL:        "https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1760605200000-invoice-INV-2026-001.pdf",
		FileName:      "invoice-INV-2026-001.pdf",
		Currency:      "EUR",
		Total:         129.9,
		IssueDate:     "2026-10-01T00:00:00.000Z",
		DueDate:       "2026-10-31T00:00:00.000Z",
	}
	if got != want {
		t.Fatalf("event =\n %+v\nwant\n %+v", got, want)
	}
	wantMeta(t, meta)
}

// The producer drops dueDate entirely (JSON.stringify omits undefined); it must decode as empty.
func TestContractPdfGeneratedWithoutDueDate(t *testing.T) {
	event, _, ok, err := Decode(readFixture(t, "invoice.pdf.generated.no-due-date.json"))
	if err != nil || !ok {
		t.Fatalf("Decode: ok=%v err=%v", ok, err)
	}

	got := event.(PdfGeneratedEvent)
	if got.DueDate != "" || got.Total != 10 || got.Currency != "USD" {
		t.Fatalf("event = %+v", got)
	}
}

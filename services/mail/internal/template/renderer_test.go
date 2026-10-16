package template

import (
	"strings"
	"testing"
)

func TestRenderInvoiceEmailIncludesTheInvoiceDetails(t *testing.T) {
	html, err := RenderInvoiceEmail(InvoiceEmailData{
		ClientName:    "Acme Corp",
		InvoiceNumber: "INV-2026-001",
		Currency:      "EUR",
		Total:         "129.90",
		IssueDate:     "2026-10-01",
		DueDate:       "2026-10-31",
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	for _, want := range []string{"Hi Acme Corp,", "INVOICE INV-2026-001", "129.90 EUR", "2026-10-31"} {
		if !strings.Contains(html, want) {
			t.Errorf("email is missing %q", want)
		}
	}
}

func TestRenderInvoiceEmailOmitsTheDueDateRowWhenThereIsNone(t *testing.T) {
	html, err := RenderInvoiceEmail(InvoiceEmailData{ClientName: "A", InvoiceNumber: "I", IssueDate: "2026-10-01"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(html, "Due") {
		t.Fatalf("expected no due-date row, got:\n%s", html)
	}
}

// Client names come from user-supplied invoice data and end up in someone's mail client.
func TestRenderInvoiceEmailEscapesUserSuppliedText(t *testing.T) {
	html, err := RenderInvoiceEmail(InvoiceEmailData{
		ClientName:    `<img src=x onerror="alert(1)">`,
		InvoiceNumber: `<script>steal()</script>`,
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	if strings.Contains(html, "<script>steal()") || strings.Contains(html, "<img src=x") {
		t.Fatalf("user-supplied markup was rendered unescaped:\n%s", html)
	}
	if !strings.Contains(html, "&lt;script&gt;steal()&lt;/script&gt;") {
		t.Fatalf("expected escaped markup in output")
	}
}

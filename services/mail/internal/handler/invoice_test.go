package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"einvoice/mail/internal/mail"
)

// fakeSender records what would have been emailed — the same DI seam (mail.Sender) the SMTP and
// SES implementations plug into.
type fakeSender struct {
	sent []mail.Message
	err  error
}

func (f *fakeSender) Send(_ context.Context, msg mail.Message) error {
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, msg)
	return nil
}

var pdfBytes = []byte("%PDF-1.7 fake invoice")

func pdfServer(t *testing.T, status int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write(pdfBytes)
	}))
	t.Cleanup(server.Close)
	return server
}

func sentMessage(pdfURL string) []byte {
	return []byte(fmt.Sprintf(`{
	  "data": {
	    "type": "invoice.sent", "invoiceId": "i1", "invoiceNumber": "INV-7",
	    "clientName": "Acme Corp", "clientEmail": "billing@acme.test", "pdfUrl": %q,
	    "fileName": "invoice-INV-7.pdf", "currency": "EUR", "total": 1234.5, "issueDate": "2026-10-01"
	  },
	  "meta": {"correlationId": "c1", "traceId": "t1", "sourceService": "invoice", "timestamp": "2026-10-16T09:00:00.000Z"}
	}`, pdfURL))
}

func TestHandleEmailsTheSentInvoicePdfToTheClient(t *testing.T) {
	sender := &fakeSender{}
	server := pdfServer(t, http.StatusOK)

	if err := NewInvoiceHandler(sender).Handle(context.Background(), nil, sentMessage(server.URL+"/invoice.pdf")); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(sender.sent))
	}
	msg := sender.sent[0]
	if msg.To != "billing@acme.test" || msg.Subject != "Invoice INV-7" {
		t.Fatalf("To/Subject = %q / %q", msg.To, msg.Subject)
	}
	if !strings.Contains(msg.HTMLBody, "1234.50 EUR") {
		t.Fatalf("body is missing the formatted total")
	}
	if len(msg.Attachments) != 1 || msg.Attachments[0].Filename != "invoice-INV-7.pdf" ||
		msg.Attachments[0].ContentType != "application/pdf" || !bytes.Equal(msg.Attachments[0].Data, pdfBytes) {
		t.Fatalf("attachment = %+v", msg.Attachments)
	}
}

// Returning an error is what makes the consumer leave the offset uncommitted and retry — an email
// with no PDF attached, or no email at all, must not be treated as done.
func TestHandleFailsWithoutSendingWhenThePdfCannotBeFetched(t *testing.T) {
	sender := &fakeSender{}
	server := pdfServer(t, http.StatusNotFound)

	err := NewInvoiceHandler(sender).Handle(context.Background(), nil, sentMessage(server.URL+"/missing.pdf"))

	if err == nil || !strings.Contains(err.Error(), "unexpected status 404") {
		t.Fatalf("err = %v, want a 404 fetch error", err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("an email was sent without its PDF")
	}
}

func TestHandleReturnsTheSenderError(t *testing.T) {
	sender := &fakeSender{err: errors.New("smtp: 421 try again later")}
	server := pdfServer(t, http.StatusOK)

	err := NewInvoiceHandler(sender).Handle(context.Background(), nil, sentMessage(server.URL))

	if err == nil || !strings.Contains(err.Error(), "421") {
		t.Fatalf("err = %v, want the sender error", err)
	}
}

func TestHandleAcknowledgesDemoAndUnknownEventsWithoutSending(t *testing.T) {
	sender := &fakeSender{}
	h := NewInvoiceHandler(sender)

	for _, raw := range []string{
		`{"data":{"type":"invoice.demo","invoiceId":"i1","message":"hi"},"meta":{"correlationId":"c1"}}`,
		`{"data":{"type":"invoice.voided","invoiceId":"i1"},"meta":{"correlationId":"c1"}}`,
	} {
		if err := h.Handle(context.Background(), nil, []byte(raw)); err != nil {
			t.Fatalf("Handle(%s): %v", raw, err)
		}
	}
	if len(sender.sent) != 0 {
		t.Fatalf("sent %d emails for non-PDF events", len(sender.sent))
	}
}

func TestHandleRejectsAMalformedMessage(t *testing.T) {
	if err := NewInvoiceHandler(&fakeSender{}).Handle(context.Background(), nil, []byte(`not json`)); err == nil {
		t.Fatal("expected a decode error")
	}
}

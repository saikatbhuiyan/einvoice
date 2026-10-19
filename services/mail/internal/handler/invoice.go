// Package handler contains the per-message business logic the Kafka consumer loop delegates to.
//
// Error contract with the consumer: return nil when the message is done with (handled, a
// duplicate, or not ours); wrap failures retrying can never fix in failure.Permanent (the message is
// dead-lettered); return anything else to have it retried.
package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"einvoice/mail/internal/dedupe"
	"einvoice/mail/internal/events"
	"einvoice/mail/internal/failure"
	"einvoice/mail/internal/mail"
	"einvoice/mail/internal/storage"
	"einvoice/mail/internal/template"
)

const httpFetchTimeout = 30 * time.Second

type InvoiceHandler struct {
	sender mail.Sender
	pdfs   storage.PDFStore
	dedupe dedupe.Store
	// Only for legacy invoice.sent messages that carry a public pdfUrl instead of a pdfKey.
	client *http.Client
}

func NewInvoiceHandler(sender mail.Sender, pdfs storage.PDFStore, dedupe dedupe.Store) *InvoiceHandler {
	return &InvoiceHandler{
		sender: sender,
		pdfs:   pdfs,
		dedupe: dedupe,
		client: &http.Client{Timeout: httpFetchTimeout},
	}
}

// Handle is the Kafka consumer's Handler func: decode the envelope, dispatch on event type.
func (h *InvoiceHandler) Handle(ctx context.Context, _ []byte, value []byte) error {
	event, meta, ok, err := events.Decode(value)
	if err != nil {
		// Bytes that don't decode today won't decode tomorrow.
		return failure.Permanent(fmt.Errorf("decode invoice event: %w", err))
	}
	if !ok {
		// A type this service doesn't handle (e.g. invoice.cancelled, for payment) -- nothing to do.
		return nil
	}

	switch e := event.(type) {
	case events.DemoEvent:
		slog.Info("received demo event", "invoiceId", e.InvoiceID, "message", e.Message, "correlationId", meta.CorrelationID)
		return nil
	case events.SentEvent:
		return h.handleSent(ctx, e, meta)
	default:
		return nil
	}
}

func (h *InvoiceHandler) handleSent(ctx context.Context, e events.SentEvent, meta events.Meta) error {
	log := slog.With("invoiceId", e.InvoiceID, "invoiceNumber", e.InvoiceNumber, "eventId", e.EventID, "correlationId", meta.CorrelationID)

	if e.EventID != "" {
		seen, err := h.dedupe.Seen(ctx, e.EventID)
		if err != nil {
			// Unknown whether it was already sent: don't risk a duplicate, retry once Redis answers.
			return err
		}
		if seen {
			log.Info("duplicate invoice.sent event, email already sent; skipping")
			return nil
		}
	}

	log.Info("sending invoice email")

	pdfBytes, err := h.loadPDF(ctx, e)
	if err != nil {
		return err
	}

	html, err := template.RenderInvoiceEmail(template.InvoiceEmailData{
		ClientName:    e.ClientName,
		InvoiceNumber: e.InvoiceNumber,
		Currency:      e.Currency,
		Total:         fmt.Sprintf("%.2f", e.Total),
		IssueDate:     e.IssueDate,
		DueDate:       e.DueDate,
	})
	if err != nil {
		return failure.Permanent(fmt.Errorf("render email template: %w", err))
	}

	msg := mail.Message{
		To:       e.ClientEmail,
		Subject:  fmt.Sprintf("Invoice %s", e.InvoiceNumber),
		HTMLBody: html,
		Attachments: []mail.Attachment{
			{Filename: e.FileName, ContentType: "application/pdf", Data: pdfBytes},
		},
	}

	if err := h.sender.Send(ctx, msg); err != nil {
		return fmt.Errorf("send invoice email: %w", err)
	}

	if e.EventID != "" {
		// Not returned: the email is already out, and a retry would send it again. The cost of a
		// lost mark is a possible duplicate if this exact event is redelivered.
		if err := h.dedupe.Mark(ctx, e.EventID); err != nil {
			log.Warn("invoice email sent but not recorded for dedupe", "error", err)
		}
	}

	log.Info("invoice email sent", "to", e.ClientEmail)
	return nil
}

func (h *InvoiceHandler) loadPDF(ctx context.Context, e events.SentEvent) ([]byte, error) {
	switch {
	case e.PdfKey != "":
		return h.pdfs.Get(ctx, e.PdfKey)
	case e.PdfURL != "":
		return h.fetchLegacyPDF(ctx, e.PdfURL)
	default:
		return nil, failure.Permanent(errors.New("invoice.sent event has neither pdfKey nor pdfUrl"))
	}
}

func (h *InvoiceHandler) fetchLegacyPDF(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, failure.Permanent(fmt.Errorf("fetch PDF from %q: %w", url, err))
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch PDF from %q: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("fetch PDF from %q: unexpected status %d", url, resp.StatusCode)
		// A 4xx (the object is gone, or the URL is no longer public) won't change on retry; a 5xx,
		// a timeout (408) or throttling (429) might.
		if resp.StatusCode >= 400 && resp.StatusCode < 500 &&
			resp.StatusCode != http.StatusRequestTimeout && resp.StatusCode != http.StatusTooManyRequests {
			return nil, failure.Permanent(err)
		}
		return nil, err
	}

	return io.ReadAll(resp.Body)
}

// Package handler contains the per-message business logic the Kafka consumer loop delegates to.
package handler

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"einvoice/mail/internal/events"
	"einvoice/mail/internal/mail"
	"einvoice/mail/internal/template"
)

const httpFetchTimeout = 30 * time.Second

type InvoiceHandler struct {
	sender mail.Sender
	client *http.Client
}

func NewInvoiceHandler(sender mail.Sender) *InvoiceHandler {
	return &InvoiceHandler{
		sender: sender,
		client: &http.Client{Timeout: httpFetchTimeout},
	}
}

// Handle is the Kafka consumer's Handler func: decode the envelope, dispatch on event type.
func (h *InvoiceHandler) Handle(ctx context.Context, _ []byte, value []byte) error {
	event, meta, ok, err := events.Decode(value)
	if err != nil {
		return fmt.Errorf("decode invoice event: %w", err)
	}
	if !ok {
		// A type this handler doesn't recognize -- not an error, just nothing to do. The topic
		// may grow more event types later that this version of the service has no handler for.
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
	slog.Info("sending invoice email", "invoiceId", e.InvoiceID, "invoiceNumber", e.InvoiceNumber, "correlationId", meta.CorrelationID)

	pdfBytes, err := h.fetchPDF(ctx, e.PdfURL)
	if err != nil {
		return fmt.Errorf("fetch PDF from %q: %w", e.PdfURL, err)
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
		return fmt.Errorf("render email template: %w", err)
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

	slog.Info("invoice email sent", "invoiceId", e.InvoiceID, "to", e.ClientEmail)
	return nil
}

func (h *InvoiceHandler) fetchPDF(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

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
	"einvoice/mail/internal/money"
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
	case events.ReminderEvent:
		return h.handleReminder(ctx, e, meta)
	default:
		return nil
	}
}

func (h *InvoiceHandler) handleSent(ctx context.Context, e events.SentEvent, meta events.Meta) error {
	log := slog.With("invoiceId", e.InvoiceID, "invoiceNumber", e.InvoiceNumber, "eventId", e.EventID,
		"organizationId", meta.OrganizationID, "correlationId", meta.CorrelationID)

	return h.sendOnce(ctx, log, e.EventID, "invoice email", func() (mail.Message, error) {
		pdfBytes, err := h.loadPDF(ctx, e)
		if err != nil {
			return mail.Message{}, err
		}
		html, err := template.RenderInvoiceEmail(template.InvoiceEmailData{
			ClientName:    e.ClientName,
			InvoiceNumber: e.InvoiceNumber,
			Currency:      e.Currency,
			Total:         money.Format(money.FromEvent(e.TotalMinor, e.Total, e.Currency), e.Currency),
			IssueDate:     e.IssueDate,
			DueDate:       e.DueDate,
		})
		if err != nil {
			return mail.Message{}, failure.Permanent(fmt.Errorf("render email template: %w", err))
		}
		return mail.Message{
			To:          e.ClientEmail,
			Subject:     fmt.Sprintf("Invoice %s", e.InvoiceNumber),
			HTMLBody:    html,
			Attachments: []mail.Attachment{{Filename: e.FileName, ContentType: "application/pdf", Data: pdfBytes}},
		}, nil
	})
}

func (h *InvoiceHandler) handleReminder(ctx context.Context, e events.ReminderEvent, meta events.Meta) error {
	log := slog.With("invoiceId", e.InvoiceID, "invoiceNumber", e.InvoiceNumber, "eventId", e.EventID,
		"reminderNumber", e.ReminderNumber, "organizationId", meta.OrganizationID,
		"systemActor", meta.SystemActor, "correlationId", meta.CorrelationID)

	return h.sendOnce(ctx, log, e.EventID, "payment reminder", func() (mail.Message, error) {
		if e.PdfKey == "" {
			return mail.Message{}, failure.Permanent(errors.New("invoice.reminder event has no pdfKey"))
		}
		pdfBytes, err := h.pdfs.Get(ctx, e.PdfKey)
		if err != nil {
			return mail.Message{}, err
		}
		html, err := template.RenderReminderEmail(template.ReminderEmailData{
			ClientName:     e.ClientName,
			InvoiceNumber:  e.InvoiceNumber,
			Currency:       e.Currency,
			Total:          money.Format(money.FromEvent(e.TotalMinor, e.Total, e.Currency), e.Currency),
			DueDate:        dateOnly(e.DueDate),
			DaysOverdue:    e.DaysOverdue,
			ReminderNumber: e.ReminderNumber,
		})
		if err != nil {
			return mail.Message{}, failure.Permanent(fmt.Errorf("render reminder template: %w", err))
		}
		return mail.Message{
			To:          e.ClientEmail,
			Subject:     fmt.Sprintf("Reminder: invoice %s is overdue", e.InvoiceNumber),
			HTMLBody:    html,
			Attachments: []mail.Attachment{{Filename: e.FileName, ContentType: "application/pdf", Data: pdfBytes}},
		}, nil
	})
}

// sendOnce emails what build returns, unless eventID was already emailed (delivery is
// at-least-once). An unknown dedupe state is retried, never guessed: guessing "not sent" risks a
// duplicate. A failure to record the send is only logged -- the email is already out, and failing
// the message would send it again.
func (h *InvoiceHandler) sendOnce(ctx context.Context, log *slog.Logger, eventID, what string, build func() (mail.Message, error)) error {
	if eventID != "" {
		seen, err := h.dedupe.Seen(ctx, eventID)
		if err != nil {
			return err
		}
		if seen {
			log.Info("duplicate event, " + what + " already sent; skipping")
			return nil
		}
	}

	log.Info("sending " + what)
	msg, err := build()
	if err != nil {
		return err
	}
	if err := h.sender.Send(ctx, msg); err != nil {
		return fmt.Errorf("send %s: %w", what, err)
	}

	if eventID != "" {
		if err := h.dedupe.Mark(ctx, eventID); err != nil {
			log.Warn(what+" sent but not recorded for dedupe", "error", err)
		}
	}
	log.Info(what+" sent", "to", msg.To)
	return nil
}

// dateOnly shows an ISO-8601 instant as its date (the due date is midnight UTC of the due day).
func dateOnly(iso string) string {
	if len(iso) >= len("2006-01-02") {
		return iso[:len("2006-01-02")]
	}
	return iso
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

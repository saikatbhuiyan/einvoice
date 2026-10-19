// Package events mirrors libs/transports/src/lib/invoice-events.types.ts and rpc-envelope.ts on
// the Go side of a plain JSON contract -- this service can't import that TypeScript directly
// (it's outside the pnpm/Nx workspace). Keep both in sync by hand when either changes; see
// docs/invoice-kafka-producer.md for the agreed wire shape.
package events

import "encoding/json"

// Meta mirrors RpcMeta (libs/transports/src/lib/rpc-envelope.ts). Roles/Permissions/UserID are
// rarely populated for these events (invoice create/send run in a request's correlation
// context, which does carry them when a real end user triggered the call) but are never required
// by this consumer -- it only ever logs them for tracing, never authorizes on them.
type Meta struct {
	CorrelationID string   `json:"correlationId"`
	TraceID       string   `json:"traceId"`
	UserID        string   `json:"userId,omitempty"`
	Roles         []string `json:"roles,omitempty"`
	Permissions   []string `json:"permissions,omitempty"`
	SourceService string   `json:"sourceService"`
	Timestamp     string   `json:"timestamp"`
}

// Envelope mirrors RpcEnvelope<T>. Data is decoded in two passes: first just enough to read
// Type, then into the concrete struct that Type selects -- see Decode below.
type Envelope struct {
	Data json.RawMessage `json:"data"`
	Meta Meta            `json:"meta"`
}

type typeOnly struct {
	Type string `json:"type"`
}

const (
	TypeDemo = "invoice.demo"
	TypeSent = "invoice.sent"
	// TypeCancelled is consumed by apps/payment, not this service; Decode reports it as not ours.
	TypeCancelled = "invoice.cancelled"
	// TypePdfGeneratedLegacy is what the producer emitted before invoice.sent replaced it (same
	// payload). Nothing produces it any more, but messages of this type can still be on the topic
	// within its retention window, so it decodes as a SentEvent. Remove once retention has passed,
	// together with libs/transports/src/contracts/kafka/invoice.pdf.generated.legacy.json.
	TypePdfGeneratedLegacy = "invoice.pdf.generated"
)

type DemoEvent struct {
	Type      string `json:"type"`
	EventID   string `json:"eventId,omitempty"`
	InvoiceID string `json:"invoiceId"`
	Message   string `json:"message"`
}

// SentEvent means the invoice was sent to the client: email ClientEmail with the PDF attached.
//
// EventID (the producer's outbox row id) is what duplicates are recognised by. PdfKey is the S3 key
// of the PDF in the private bucket. Messages produced before PDFs became private carry PdfURL (a
// public object URL) instead, and no EventID -- still handled, just without dedupe.
type SentEvent struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventId,omitempty"`
	InvoiceID     string  `json:"invoiceId"`
	InvoiceNumber string  `json:"invoiceNumber"`
	ClientName    string  `json:"clientName"`
	ClientEmail   string  `json:"clientEmail"`
	PdfKey        string  `json:"pdfKey,omitempty"`
	PdfURL        string  `json:"pdfUrl,omitempty"`
	FileName      string  `json:"fileName"`
	Currency      string  `json:"currency"`
	Total         float64 `json:"total"`
	IssueDate     string  `json:"issueDate"`
	DueDate       string  `json:"dueDate,omitempty"`
}

// Decode parses a raw Kafka message value into an Envelope and the concrete event type its
// data.type field selects. Returns (nil, nil, Meta{}, false) for a recognized-but-ignored type,
// so callers can distinguish "not our event" from "malformed message" (the latter is an error).
func Decode(raw []byte) (event any, meta Meta, ok bool, err error) {
	var envelope Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, Meta{}, false, err
	}

	var t typeOnly
	if err := json.Unmarshal(envelope.Data, &t); err != nil {
		return nil, envelope.Meta, false, err
	}

	switch t.Type {
	case TypeDemo:
		var demo DemoEvent
		if err := json.Unmarshal(envelope.Data, &demo); err != nil {
			return nil, envelope.Meta, false, err
		}
		return demo, envelope.Meta, true, nil
	case TypeSent, TypePdfGeneratedLegacy:
		var sent SentEvent
		if err := json.Unmarshal(envelope.Data, &sent); err != nil {
			return nil, envelope.Meta, false, err
		}
		return sent, envelope.Meta, true, nil
	default:
		return nil, envelope.Meta, false, nil
	}
}

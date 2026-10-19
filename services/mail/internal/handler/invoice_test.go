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

	"einvoice/mail/internal/failure"
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

type fakeStore struct {
	objects map[string][]byte
	err     error
	gets    []string
}

func (f *fakeStore) Get(_ context.Context, key string) ([]byte, error) {
	f.gets = append(f.gets, key)
	if f.err != nil {
		return nil, f.err
	}
	return f.objects[key], nil
}

type fakeDedupe struct {
	seen    map[string]bool
	seenErr error
	markErr error
	marked  []string
	checked []string
}

func (f *fakeDedupe) Seen(_ context.Context, eventID string) (bool, error) {
	f.checked = append(f.checked, eventID)
	return f.seen[eventID], f.seenErr
}

func (f *fakeDedupe) Mark(_ context.Context, eventID string) error {
	if f.markErr != nil {
		return f.markErr
	}
	f.marked = append(f.marked, eventID)
	return nil
}

var pdfBytes = []byte("%PDF-1.7 fake invoice")

const pdfKey = "invoices/u1/invoice-INV-7.pdf"

type fixture struct {
	sender *fakeSender
	store  *fakeStore
	dedupe *fakeDedupe
	h      *InvoiceHandler
}

func newFixture() *fixture {
	f := &fixture{
		sender: &fakeSender{},
		store:  &fakeStore{objects: map[string][]byte{pdfKey: pdfBytes}},
		dedupe: &fakeDedupe{seen: map[string]bool{}},
	}
	f.h = NewInvoiceHandler(f.sender, f.store, f.dedupe)
	return f
}

func (f *fixture) handle(t *testing.T, raw []byte) error {
	t.Helper()
	return f.h.Handle(context.Background(), nil, raw)
}

// pdfField is `"pdfKey": "..."` or (legacy) `"pdfUrl": "..."`; eventID "" omits it (legacy).
func sentMessage(eventID, pdfField string) []byte {
	eventField := ""
	if eventID != "" {
		eventField = fmt.Sprintf(`"eventId": %q,`, eventID)
	}
	return []byte(fmt.Sprintf(`{
	  "data": {
	    "type": "invoice.sent", %s "invoiceId": "i1", "invoiceNumber": "INV-7",
	    "clientName": "Acme Corp", "clientEmail": "billing@acme.test", %s,
	    "fileName": "invoice-INV-7.pdf", "currency": "EUR", "total": 1234.5, "issueDate": "2026-10-01"
	  },
	  "meta": {"correlationId": "c1", "traceId": "t1", "sourceService": "invoice", "timestamp": "2026-10-16T09:00:00.000Z"}
	}`, eventField, pdfField))
}

var keyed = fmt.Sprintf(`"pdfKey": %q`, pdfKey)

func TestHandleEmailsThePdfFromTheBucketAndRecordsTheEvent(t *testing.T) {
	f := newFixture()

	if err := f.handle(t, sentMessage("evt-1", keyed)); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(f.sender.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(f.sender.sent))
	}
	msg := f.sender.sent[0]
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
	if len(f.store.gets) != 1 || f.store.gets[0] != pdfKey {
		t.Fatalf("store reads = %v, want [%s]", f.store.gets, pdfKey)
	}
	if len(f.dedupe.marked) != 1 || f.dedupe.marked[0] != "evt-1" {
		t.Fatalf("marked = %v, want [evt-1]", f.dedupe.marked)
	}
}

// At-least-once delivery: the outbox relay or a consumer restart can deliver the same event again.
func TestHandleSkipsAnEventThatWasAlreadySent(t *testing.T) {
	f := newFixture()
	f.dedupe.seen["evt-1"] = true

	if err := f.handle(t, sentMessage("evt-1", keyed)); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(f.sender.sent) != 0 || len(f.store.gets) != 0 {
		t.Fatalf("a duplicate was processed again: sent=%d reads=%d", len(f.sender.sent), len(f.store.gets))
	}
}

func TestHandleRetriesWhenItCannotTellWhetherTheEventWasSent(t *testing.T) {
	f := newFixture()
	f.dedupe.seenErr = errors.New("redis: connection refused")

	err := f.handle(t, sentMessage("evt-1", keyed))

	if err == nil || failure.IsPermanent(err) {
		t.Fatalf("err = %v, want a transient error", err)
	}
	if len(f.sender.sent) != 0 {
		t.Fatal("sent without knowing whether it was a duplicate")
	}
}

// The email is out; failing now would make the consumer retry and send it twice.
func TestHandleSucceedsWhenTheEmailWentOutButCouldNotBeRecorded(t *testing.T) {
	f := newFixture()
	f.dedupe.markErr = errors.New("redis: timeout")

	if err := f.handle(t, sentMessage("evt-1", keyed)); err != nil {
		t.Fatalf("Handle: %v (must not be retried after a successful send)", err)
	}
	if len(f.sender.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(f.sender.sent))
	}
}

func TestHandlePropagatesTheStoreErrorClassificationWithoutSending(t *testing.T) {
	for name, storeErr := range map[string]error{
		"missing object (permanent)": failure.Permanent(errors.New("NoSuchKey")),
		"S3 unavailable (transient)": errors.New("503 SlowDown"),
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture()
			f.store.err = storeErr

			err := f.handle(t, sentMessage("evt-1", keyed))

			if err == nil || failure.IsPermanent(err) != failure.IsPermanent(storeErr) {
				t.Fatalf("err = %v, want classification of %v", err, storeErr)
			}
			if len(f.sender.sent) != 0 || len(f.dedupe.marked) != 0 {
				t.Fatal("an email without its PDF must not be sent or recorded")
			}
		})
	}
}

func TestHandlePropagatesTheSenderErrorClassification(t *testing.T) {
	for name, sendErr := range map[string]error{
		"greylisted (transient)":      errors.New("smtp: 451 try again later"),
		"no such mailbox (permanent)": failure.Permanent(errors.New("smtp: 550 no such user")),
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture()
			f.sender.err = sendErr

			err := f.handle(t, sentMessage("evt-1", keyed))

			if err == nil || failure.IsPermanent(err) != failure.IsPermanent(sendErr) {
				t.Fatalf("err = %v, want classification of %v", err, sendErr)
			}
			if len(f.dedupe.marked) != 0 {
				t.Fatal("an email that wasn't sent must not be recorded as sent")
			}
		})
	}
}

func pdfServer(t *testing.T, status int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write(pdfBytes)
	}))
	t.Cleanup(server.Close)
	return server
}

// Messages produced before PDFs became private carry a public pdfUrl and no eventId.
func TestHandleStillSendsLegacyMessagesByUrlWithoutDedupe(t *testing.T) {
	f := newFixture()
	server := pdfServer(t, http.StatusOK)

	if err := f.handle(t, sentMessage("", fmt.Sprintf(`"pdfUrl": %q`, server.URL+"/invoice.pdf"))); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(f.sender.sent) != 1 || !bytes.Equal(f.sender.sent[0].Attachments[0].Data, pdfBytes) {
		t.Fatalf("legacy message not emailed with its PDF: %+v", f.sender.sent)
	}
	if len(f.dedupe.checked)+len(f.dedupe.marked) != 0 || len(f.store.gets) != 0 {
		t.Fatal("a legacy message has no eventId or key: no dedupe, no bucket read")
	}
}

func TestHandleClassifiesLegacyUrlFailures(t *testing.T) {
	cases := map[int]bool{
		http.StatusNotFound:           true,  // object gone
		http.StatusForbidden:          true,  // bucket no longer public
		http.StatusServiceUnavailable: false, // might recover
		http.StatusTooManyRequests:    false, // throttled
	}
	for status, wantPermanent := range cases {
		t.Run(http.StatusText(status), func(t *testing.T) {
			f := newFixture()
			server := pdfServer(t, status)

			err := f.handle(t, sentMessage("", fmt.Sprintf(`"pdfUrl": %q`, server.URL+"/x.pdf")))

			if err == nil || failure.IsPermanent(err) != wantPermanent {
				t.Fatalf("status %d: err = %v, want permanent=%v", status, err, wantPermanent)
			}
			if len(f.sender.sent) != 0 {
				t.Fatal("sent without a PDF")
			}
		})
	}
}

func TestHandleRejectsAnEventWithNoPdfAtAllAsPermanent(t *testing.T) {
	f := newFixture()

	err := f.handle(t, sentMessage("evt-1", `"unrelated": 1`))

	if !failure.IsPermanent(err) {
		t.Fatalf("err = %v, want permanent", err)
	}
}

func TestHandleAcknowledgesEventsThatAreNotForThisService(t *testing.T) {
	f := newFixture()

	for _, raw := range []string{
		`{"data":{"type":"invoice.demo","eventId":"e0","invoiceId":"i1","message":"hi"},"meta":{"correlationId":"c1"}}`,
		`{"data":{"type":"invoice.cancelled","eventId":"e1","invoiceId":"i1","invoiceNumber":"INV-7","cancelledAt":"2026-10-16T09:00:00.000Z"},"meta":{"correlationId":"c1"}}`,
		`{"data":{"type":"invoice.voided","invoiceId":"i1"},"meta":{"correlationId":"c1"}}`,
	} {
		if err := f.handle(t, []byte(raw)); err != nil {
			t.Fatalf("Handle(%s): %v", raw, err)
		}
	}
	if len(f.sender.sent) != 0 {
		t.Fatalf("sent %d emails for events that aren't invoice.sent", len(f.sender.sent))
	}
}

func TestHandleTreatsAMalformedMessageAsPermanent(t *testing.T) {
	if err := newFixture().handle(t, []byte(`not json`)); !failure.IsPermanent(err) {
		t.Fatalf("err = %v, want a permanent decode error", err)
	}
}

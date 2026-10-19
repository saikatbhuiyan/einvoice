package mail

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
)

func parseRaw(t *testing.T, raw []byte) *mail.Message {
	t.Helper()
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("raw message is not valid RFC 5322: %v\n%s", err, raw)
	}
	return msg
}

func TestBuildRawProducesAParsableMessageWithTheAttachmentIntact(t *testing.T) {
	pdf := []byte("%PDF-1.7\n\x00\xff binary payload")

	raw, err := buildRaw("Billing <billing@einvoice.test>", Message{
		To:          "client@acme.test",
		Subject:     "Invoice INV-1",
		HTMLBody:    "<p>Hello</p>",
		Attachments: []Attachment{{Filename: "invoice-INV-1.pdf", ContentType: "application/pdf", Data: pdf}},
	})
	if err != nil {
		t.Fatalf("buildRaw: %v", err)
	}

	msg := parseRaw(t, raw)
	if got := msg.Header.Get("To"); !strings.Contains(got, "client@acme.test") {
		t.Fatalf("To = %q", got)
	}
	if got := msg.Header.Get("Subject"); got != "Invoice INV-1" {
		t.Fatalf("Subject = %q", got)
	}

	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		t.Fatalf("Content-Type = %q (%v), want multipart", msg.Header.Get("Content-Type"), err)
	}

	reader := multipart.NewReader(msg.Body, params["boundary"])
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			t.Fatal("no PDF attachment part found")
		}
		if err != nil {
			t.Fatalf("NextPart: %v", err)
		}
		if part.FileName() != "invoice-INV-1.pdf" {
			continue
		}
		encoded, _ := io.ReadAll(part)
		decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(string(encoded), "\r\n", ""))
		if err != nil {
			t.Fatalf("attachment is not base64: %v", err)
		}
		if !bytes.Equal(decoded, pdf) {
			t.Fatalf("attachment bytes changed in transit")
		}
		return
	}
}

// The subject embeds the invoice number, which is user input validated only for length. A CR/LF
// in it must not be able to start a new header (e.g. add a Bcc recipient).
func TestBuildRawDoesNotAllowHeaderInjectionThroughTheSubject(t *testing.T) {
	raw, err := buildRaw("billing@einvoice.test", Message{
		To:       "client@acme.test",
		Subject:  "Invoice INV-1\r\nBcc: attacker@evil.test",
		HTMLBody: "<p>x</p>",
	})
	if err != nil {
		t.Fatalf("buildRaw: %v", err)
	}

	msg := parseRaw(t, raw)
	if bcc := msg.Header.Get("Bcc"); bcc != "" {
		t.Fatalf("injected Bcc header present: %q", bcc)
	}
	if strings.Contains(string(raw), "\r\nBcc: attacker@evil.test") {
		t.Fatalf("raw message contains an injected header line:\n%s", raw)
	}
}

func TestBuildRawRejectsAnInvalidRecipient(t *testing.T) {
	if _, err := buildRaw("billing@einvoice.test", Message{To: "not an address", Subject: "x"}); err == nil {
		t.Fatal("expected an error for an invalid To address")
	}
}

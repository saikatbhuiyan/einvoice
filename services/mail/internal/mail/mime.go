package mail

import (
	"bytes"
	"fmt"

	gomail "github.com/wneessen/go-mail"
)

// buildMsg is the one raw-MIME builder shared by both Sender implementations. SMTPSender hands
// the resulting *gomail.Msg straight to an SMTP client; SESSender serializes it to raw RFC 5322
// bytes (buildRaw below) because SES's SendEmail "Simple" content type has no attachment
// support at all -- attachments require the "Raw" content type either way, so there's no
// simpler path for SES to take.
func buildMsg(from string, msg Message) (*gomail.Msg, error) {
	m := gomail.NewMsg()

	if err := m.From(from); err != nil {
		return nil, fmt.Errorf("set from address: %w", err)
	}
	if err := m.To(msg.To); err != nil {
		return nil, fmt.Errorf("set to address: %w", err)
	}
	m.Subject(msg.Subject)
	m.SetBodyString(gomail.TypeTextHTML, msg.HTMLBody)

	for _, attachment := range msg.Attachments {
		data := attachment.Data
		m.AttachReader(
			attachment.Filename,
			bytes.NewReader(data),
			gomail.WithFileContentType(gomail.ContentType(attachment.ContentType)),
		)
	}

	return m, nil
}

// buildRaw renders the message to raw RFC 5322 bytes, for providers (SES) that take a raw MIME
// payload rather than a live SMTP connection.
func buildRaw(from string, msg Message) ([]byte, error) {
	m, err := buildMsg(from, msg)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if _, err := m.WriteTo(&buf); err != nil {
		return nil, fmt.Errorf("serialize message: %w", err)
	}
	return buf.Bytes(), nil
}

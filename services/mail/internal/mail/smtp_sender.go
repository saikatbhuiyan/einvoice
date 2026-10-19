package mail

import (
	"context"
	"errors"
	"fmt"

	gomail "github.com/wneessen/go-mail"

	"einvoice/mail/internal/config"
	"einvoice/mail/internal/failure"
)

type SMTPSender struct {
	from   string
	client *gomail.Client
}

// NewSMTPSender dials no connection yet -- go-mail's Client connects per Send call (and a Gmail
// SMTP session is cheap/short-lived enough that pooling one long-lived connection isn't worth the
// added failure modes here, unlike e.g. a database connection).
//
// TLS is mandatory by default. Policy "none" (plaintext, no auth) exists only for a local mail sink
// such as Mailpit and is rejected in production by config validation.
func NewSMTPSender(cfg config.SMTPConfig) (*SMTPSender, error) {
	opts := []gomail.Option{gomail.WithPort(cfg.Port), gomail.WithTLSPolicy(tlsPolicy(cfg.TLSPolicy))}
	if cfg.Username != "" {
		opts = append(opts,
			gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover),
			gomail.WithUsername(cfg.Username),
			gomail.WithPassword(cfg.Password),
		)
	}
	client, err := gomail.NewClient(cfg.Host, opts...)
	if err != nil {
		return nil, fmt.Errorf("configure SMTP client: %w", err)
	}
	return &SMTPSender{from: cfg.From, client: client}, nil
}

func tlsPolicy(policy string) gomail.TLSPolicy {
	switch policy {
	case config.SMTPTLSNone:
		return gomail.NoTLS
	case config.SMTPTLSOpportunistic:
		return gomail.TLSOpportunistic
	default:
		return gomail.TLSMandatory
	}
}

func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	m, err := buildMsg(s.from, msg)
	if err != nil {
		// e.g. a malformed recipient address: this message can never be built.
		return failure.Permanent(err)
	}

	if err := s.client.DialAndSendWithContext(ctx, m); err != nil {
		err = fmt.Errorf("send via SMTP: %w", err)
		if isPermanentSMTPError(err) {
			return failure.Permanent(err)
		}
		return err
	}
	return nil
}

// smtpAuthReplyCodes are 5xx replies that mean *every* message would be refused (bad credentials,
// auth required) -- a configuration problem to fix and then resume, not a reason to dead-letter
// this one message.
var smtpAuthReplyCodes = map[int]bool{530: true, 534: true, 535: true, 538: true}

// isPermanentSMTPError: only a real 5xx SMTP reply about this message is permanent. Deliberately not
// go-mail's SendError.IsTemp(), which only checks whether the error text starts with '4' -- a
// network failure ("EOF", "connection reset") would count as "not temporary" and be dead-lettered.
// ErrorCode() is the parsed SMTP reply code, or 0 when the error isn't an SMTP reply at all.
func isPermanentSMTPError(err error) bool {
	var sendErr *gomail.SendError
	if !errors.As(err, &sendErr) {
		return false
	}
	code := sendErr.ErrorCode()
	return code >= 500 && code <= 599 && !smtpAuthReplyCodes[code]
}

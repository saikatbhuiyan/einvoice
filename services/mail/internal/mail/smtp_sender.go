package mail

import (
	"context"
	"fmt"

	gomail "github.com/wneessen/go-mail"
)

type SMTPSender struct {
	from   string
	client *gomail.Client
}

// NewSMTPSender dials no connection yet -- go-mail's Client connects per Send call (and a Gmail
// SMTP session is cheap/short-lived enough that pooling one long-lived connection isn't worth the
// added failure modes here, unlike e.g. a database connection).
func NewSMTPSender(host string, port int, username, password, from string) (*SMTPSender, error) {
	client, err := gomail.NewClient(host,
		gomail.WithPort(port),
		gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover),
		gomail.WithTLSPolicy(gomail.TLSMandatory),
		gomail.WithUsername(username),
		gomail.WithPassword(password),
	)
	if err != nil {
		return nil, fmt.Errorf("configure SMTP client: %w", err)
	}

	return &SMTPSender{from: from, client: client}, nil
}

func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	m, err := buildMsg(s.from, msg)
	if err != nil {
		return err
	}

	if err := s.client.DialAndSendWithContext(ctx, m); err != nil {
		return fmt.Errorf("send via SMTP: %w", err)
	}
	return nil
}

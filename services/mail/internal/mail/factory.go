package mail

import (
	"context"
	"fmt"

	"einvoice/mail/internal/config"
)

// NewSender is the one place that knows which concrete Sender backs the interface -- swapping
// providers later (a third option, or changing the default) means changing this function only,
// never any caller.
func NewSender(ctx context.Context, cfg *config.Config) (Sender, error) {
	switch cfg.MailProvider {
	case config.ProviderSMTP:
		return NewSMTPSender(cfg.SMTP.Host, cfg.SMTP.Port, cfg.SMTP.Username, cfg.SMTP.Password, cfg.SMTP.From)
	case config.ProviderSES:
		return NewSESSender(ctx, cfg.SES.Region, cfg.SES.FromAddr)
	default:
		return nil, fmt.Errorf("unknown mail provider %q", cfg.MailProvider)
	}
}

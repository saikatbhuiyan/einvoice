// Package config loads and validates this service's environment at startup. Same "fail fast at
// boot, not on the first request" spirit as the TS apps' CONFIGURATION.validate() singleton,
// expressed in Go idiom: a plain struct built once by Load(), which returns an error the caller
// is expected to treat as fatal.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type MailProvider string

const (
	ProviderSMTP MailProvider = "smtp"
	ProviderSES  MailProvider = "ses"
)

type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

type SESConfig struct {
	Region   string
	FromAddr string
}

type Config struct {
	AppEnv             string // development | staging | production
	KafkaBrokers       []string
	KafkaTopic         string
	KafkaConsumerGroup string
	MailProvider       MailProvider
	SMTP               SMTPConfig
	SES                SESConfig
}

// Load reads environment variables and validates them. MAIL_PROVIDER, if set, always wins;
// otherwise the provider defaults by APP_ENV (development -> smtp, anything else -> ses) --
// Gmail SMTP needs no AWS account to exercise locally, mirroring how s3mock stands in for S3 in
// dev; SES is what's actually reachable from staging/production infra.
func Load() (*Config, error) {
	appEnv := getenv("APP_ENV", "development")

	cfg := &Config{
		AppEnv:             appEnv,
		KafkaBrokers:       splitAndTrim(getenv("KAFKA_BROKERS", "localhost:9092")),
		KafkaTopic:         getenv("KAFKA_TOPIC_INVOICE_EVENTS", "invoice.events"),
		KafkaConsumerGroup: getenv("KAFKA_CONSUMER_GROUP", "mail-service"),
		MailProvider:       resolveProvider(appEnv),
		SMTP: SMTPConfig{
			Host:     os.Getenv("SMTP_HOST"),
			Port:     atoiDefault(os.Getenv("SMTP_PORT"), 587),
			Username: os.Getenv("SMTP_USERNAME"),
			Password: os.Getenv("SMTP_PASSWORD"),
			From:     os.Getenv("SMTP_FROM"),
		},
		SES: SESConfig{
			Region:   getenv("AWS_REGION", "us-east-1"),
			FromAddr: os.Getenv("SES_FROM_EMAIL"),
		},
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if len(c.KafkaBrokers) == 0 {
		return fmt.Errorf("KAFKA_BROKERS must not be empty")
	}

	switch c.MailProvider {
	case ProviderSMTP:
		if c.SMTP.Host == "" || c.SMTP.Username == "" || c.SMTP.Password == "" || c.SMTP.From == "" {
			return fmt.Errorf("SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM are required when MAIL_PROVIDER=smtp")
		}
	case ProviderSES:
		if c.SES.FromAddr == "" {
			return fmt.Errorf("SES_FROM_EMAIL is required when MAIL_PROVIDER=ses")
		}
	default:
		return fmt.Errorf("unknown mail provider %q (expected %q or %q)", c.MailProvider, ProviderSMTP, ProviderSES)
	}

	return nil
}

func resolveProvider(appEnv string) MailProvider {
	if explicit := os.Getenv("MAIL_PROVIDER"); explicit != "" {
		return MailProvider(strings.ToLower(explicit))
	}
	if appEnv == "development" {
		return ProviderSMTP
	}
	return ProviderSES
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitAndTrim(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func atoiDefault(s string, fallback int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}

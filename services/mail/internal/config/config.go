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
	// TLSPolicy: "mandatory" (default; STARTTLS required -- Gmail, any real relay),
	// "opportunistic", or "none" (plaintext, no auth: a local mail sink such as Mailpit). "none" is
	// refused when APP_ENV=production.
	TLSPolicy string
}

const (
	SMTPTLSMandatory     = "mandatory"
	SMTPTLSOpportunistic = "opportunistic"
	SMTPTLSNone          = "none"
)

type SESConfig struct {
	Region   string
	FromAddr string
}

// S3Config locates the private bucket apps/media writes invoice PDFs to. Static keys are for dev
// (s3mock) only; production leaves them unset and uses the task/instance role.
type S3Config struct {
	Bucket          string
	Region          string
	Endpoint        string
	ForcePathStyle  bool
	AccessKeyID     string
	SecretAccessKey string
}

// RedisConfig is the dedupe store (which events already produced an email).
type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type Config struct {
	AppEnv             string // development | staging | production
	KafkaBrokers       []string
	KafkaTopic         string
	KafkaConsumerGroup string
	KafkaDLQTopic      string
	MailProvider       MailProvider
	SMTP               SMTPConfig
	SES                SESConfig
	S3                 S3Config
	Redis              RedisConfig
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
		KafkaDLQTopic:      getenv("KAFKA_TOPIC_INVOICE_EVENTS_DLQ", "invoice.events.dlq"),
		MailProvider:       resolveProvider(appEnv),
		SMTP: SMTPConfig{
			Host:      os.Getenv("SMTP_HOST"),
			Port:      atoiDefault(os.Getenv("SMTP_PORT"), 587),
			Username:  os.Getenv("SMTP_USERNAME"),
			Password:  os.Getenv("SMTP_PASSWORD"),
			From:      os.Getenv("SMTP_FROM"),
			TLSPolicy: strings.ToLower(getenv("SMTP_TLS_POLICY", SMTPTLSMandatory)),
		},
		SES: SESConfig{
			Region:   getenv("AWS_REGION", "us-east-1"),
			FromAddr: os.Getenv("SES_FROM_EMAIL"),
		},
		S3: S3Config{
			Bucket:          os.Getenv("S3_BUCKET"),
			Region:          getenv("S3_REGION", getenv("AWS_REGION", "us-east-1")),
			Endpoint:        os.Getenv("S3_ENDPOINT"),
			ForcePathStyle:  os.Getenv("S3_FORCE_PATH_STYLE") == "true",
			AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID"),
			SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		},
		Redis: RedisConfig{
			Addr:     redisAddr(),
			Password: os.Getenv("REDIS_PASSWORD"),
			DB:       atoiDefault(os.Getenv("REDIS_DB"), 0),
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
	if c.S3.Bucket == "" {
		return fmt.Errorf("S3_BUCKET is required (the bucket invoice PDFs are read from)")
	}
	if c.Redis.Addr == "" {
		return fmt.Errorf("REDIS_HOST is required (the dedupe store)")
	}

	switch c.MailProvider {
	case ProviderSMTP:
		switch c.SMTP.TLSPolicy {
		case SMTPTLSMandatory, SMTPTLSOpportunistic:
			if c.SMTP.Host == "" || c.SMTP.Username == "" || c.SMTP.Password == "" || c.SMTP.From == "" {
				return fmt.Errorf("SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM are required when MAIL_PROVIDER=smtp")
			}
		case SMTPTLSNone:
			if c.AppEnv == "production" {
				return fmt.Errorf("SMTP_TLS_POLICY=none (plaintext SMTP) is not allowed when APP_ENV=production")
			}
			if c.SMTP.Host == "" || c.SMTP.From == "" {
				return fmt.Errorf("SMTP_HOST and SMTP_FROM are required when MAIL_PROVIDER=smtp")
			}
		default:
			return fmt.Errorf("unknown SMTP_TLS_POLICY %q (expected %q, %q or %q)", c.SMTP.TLSPolicy, SMTPTLSMandatory, SMTPTLSOpportunistic, SMTPTLSNone)
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

// redisAddr uses the same REDIS_HOST/REDIS_PORT variables as the NestJS services.
func redisAddr() string {
	host := os.Getenv("REDIS_HOST")
	if host == "" {
		return ""
	}
	return host + ":" + getenv("REDIS_PORT", "6379")
}

func atoiDefault(s string, fallback int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}

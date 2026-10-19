package config

import (
	"reflect"
	"strings"
	"testing"
)

// t.Setenv restores every variable after the test, so cases can't leak into each other.
func setSMTP(t *testing.T) {
	t.Setenv("SMTP_HOST", "smtp.gmail.com")
	t.Setenv("SMTP_USERNAME", "user")
	t.Setenv("SMTP_PASSWORD", "app-password")
	t.Setenv("SMTP_FROM", "billing@einvoice.test")
}

// Also sets the provider-independent required variables to valid values; tests about them unset
// one explicitly.
func clearProviderEnv(t *testing.T) {
	for _, key := range []string{"MAIL_PROVIDER", "APP_ENV", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_PORT", "SES_FROM_EMAIL", "SMTP_TLS_POLICY", "KAFKA_BROKERS", "REDIS_PORT", "REDIS_DB", "S3_REGION", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE", "AWS_REGION", "KAFKA_TOPIC_INVOICE_EVENTS_DLQ"} {
		t.Setenv(key, "")
	}
	t.Setenv("S3_BUCKET", "einvoice-dev")
	t.Setenv("REDIS_HOST", "redis")
}

func TestDevelopmentDefaultsToSMTP(t *testing.T) {
	clearProviderEnv(t)
	setSMTP(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MailProvider != ProviderSMTP || cfg.SMTP.Port != 587 || cfg.KafkaTopic != "invoice.events" {
		t.Fatalf("cfg = %+v", cfg)
	}
}

func TestNonDevelopmentDefaultsToSES(t *testing.T) {
	clearProviderEnv(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("SES_FROM_EMAIL", "billing@einvoice.test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MailProvider != ProviderSES || cfg.SES.Region != "us-east-1" {
		t.Fatalf("cfg = %+v", cfg)
	}
}

func TestMailProviderOverridesTheEnvironmentDefaultCaseInsensitively(t *testing.T) {
	clearProviderEnv(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("MAIL_PROVIDER", "SMTP")
	setSMTP(t)

	cfg, err := Load()
	if err != nil || cfg.MailProvider != ProviderSMTP {
		t.Fatalf("cfg = %+v, err = %v", cfg, err)
	}
}

// Fail at startup, not on the first email hours later.
func TestLoadFailsFastOnIncompleteProviderConfig(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"smtp without credentials":   func(t *testing.T) { t.Setenv("MAIL_PROVIDER", "smtp") },
		"ses without a from address": func(t *testing.T) { t.Setenv("MAIL_PROVIDER", "ses") },
		"unknown provider":           func(t *testing.T) { t.Setenv("MAIL_PROVIDER", "carrier-pigeon") },
	}

	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			clearProviderEnv(t)
			setup(t)
			if _, err := Load(); err == nil {
				t.Fatal("expected a validation error")
			}
		})
	}
}

func TestKafkaBrokersAreSplitAndTrimmed(t *testing.T) {
	clearProviderEnv(t)
	setSMTP(t)
	t.Setenv("KAFKA_BROKERS", " kafka-1:9092, ,kafka-2:9092 ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(cfg.KafkaBrokers, []string{"kafka-1:9092", "kafka-2:9092"}) {
		t.Fatalf("brokers = %q", cfg.KafkaBrokers)
	}
}

func TestBlankBrokerListIsRejected(t *testing.T) {
	clearProviderEnv(t)
	setSMTP(t)
	t.Setenv("KAFKA_BROKERS", " , ")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "KAFKA_BROKERS") {
		t.Fatalf("err = %v", err)
	}
}

func TestRequiresTheBucketAndTheDedupeStore(t *testing.T) {
	for _, key := range []string{"S3_BUCKET", "REDIS_HOST"} {
		t.Run(key, func(t *testing.T) {
			clearProviderEnv(t)
			setSMTP(t)
			t.Setenv(key, "")

			if _, err := Load(); err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("Load() err = %v, want one naming %s", err, key)
			}
		})
	}
}

func TestStorageAndDedupeSettings(t *testing.T) {
	clearProviderEnv(t)
	setSMTP(t)
	t.Setenv("REDIS_PORT", "6380")
	t.Setenv("REDIS_DB", "2")
	t.Setenv("S3_ENDPOINT", "http://s3mock:9090")
	t.Setenv("S3_FORCE_PATH_STYLE", "true")
	t.Setenv("AWS_REGION", "eu-west-1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Redis.Addr != "redis:6380" || cfg.Redis.DB != 2 {
		t.Fatalf("redis = %+v", cfg.Redis)
	}
	// S3_REGION falls back to AWS_REGION.
	if cfg.S3.Region != "eu-west-1" || cfg.S3.Endpoint != "http://s3mock:9090" || !cfg.S3.ForcePathStyle {
		t.Fatalf("s3 = %+v", cfg.S3)
	}
	if cfg.KafkaDLQTopic != "invoice.events.dlq" {
		t.Fatalf("dlq topic = %q", cfg.KafkaDLQTopic)
	}
}

func TestSMTPTLSPolicy(t *testing.T) {
	t.Run("defaults to mandatory", func(t *testing.T) {
		clearProviderEnv(t)
		setSMTP(t)
		cfg, err := Load()
		if err != nil || cfg.SMTP.TLSPolicy != SMTPTLSMandatory {
			t.Fatalf("cfg = %+v, err = %v", cfg, err)
		}
	})

	// A local sink (Mailpit) speaks plaintext without auth.
	t.Run("none needs no credentials in development", func(t *testing.T) {
		clearProviderEnv(t)
		t.Setenv("SMTP_TLS_POLICY", "none")
		t.Setenv("SMTP_HOST", "mailpit")
		t.Setenv("SMTP_FROM", "billing@einvoice.test")
		if _, err := Load(); err != nil {
			t.Fatalf("Load: %v", err)
		}
	})

	t.Run("none is refused in production", func(t *testing.T) {
		clearProviderEnv(t)
		t.Setenv("APP_ENV", "production")
		t.Setenv("MAIL_PROVIDER", "smtp")
		t.Setenv("SMTP_TLS_POLICY", "none")
		t.Setenv("SMTP_HOST", "mailpit")
		t.Setenv("SMTP_FROM", "billing@einvoice.test")
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "not allowed") {
			t.Fatalf("err = %v, want plaintext SMTP refused in production", err)
		}
	})

	t.Run("an unknown policy is rejected", func(t *testing.T) {
		clearProviderEnv(t)
		setSMTP(t)
		t.Setenv("SMTP_TLS_POLICY", "sometimes")
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "SMTP_TLS_POLICY") {
			t.Fatalf("err = %v", err)
		}
	})
}

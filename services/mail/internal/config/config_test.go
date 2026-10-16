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

func clearProviderEnv(t *testing.T) {
	for _, key := range []string{"MAIL_PROVIDER", "APP_ENV", "SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_PORT", "SES_FROM_EMAIL", "KAFKA_BROKERS"} {
		t.Setenv(key, "")
	}
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

package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"einvoice/mail/internal/config"
	"einvoice/mail/internal/handler"
	"einvoice/mail/internal/kafka"
	"einvoice/mail/internal/mail"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		// Fail fast at boot, same discipline as every NestJS app's CONFIGURATION.validate() --
		// a misconfigured mail service should never start and then fail silently per message.
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	sender, err := mail.NewSender(ctx, cfg)
	if err != nil {
		slog.Error("failed to initialize mail sender", "provider", cfg.MailProvider, "error", err)
		os.Exit(1)
	}

	invoiceHandler := handler.NewInvoiceHandler(sender)
	consumer := kafka.NewConsumer(cfg.KafkaBrokers, cfg.KafkaConsumerGroup, cfg.KafkaTopic)
	defer func() {
		if err := consumer.Close(); err != nil {
			slog.Error("error closing Kafka consumer", "error", err)
		}
	}()

	slog.Info("mail service starting",
		"appEnv", cfg.AppEnv,
		"mailProvider", cfg.MailProvider,
		"kafkaBrokers", cfg.KafkaBrokers,
		"kafkaTopic", cfg.KafkaTopic,
		"kafkaConsumerGroup", cfg.KafkaConsumerGroup,
	)

	if err := consumer.Run(ctx, invoiceHandler.Handle); err != nil {
		slog.Error("consumer loop exited with error", "error", err)
		os.Exit(1)
	}

	slog.Info("mail service shut down cleanly")
}

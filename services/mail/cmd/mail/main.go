package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"einvoice/mail/internal/config"
	"einvoice/mail/internal/dedupe"
	"einvoice/mail/internal/handler"
	"einvoice/mail/internal/kafka"
	"einvoice/mail/internal/mail"
	"einvoice/mail/internal/storage"
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

	pdfs, err := storage.NewS3Store(ctx, storage.S3Config(cfg.S3))
	if err != nil {
		slog.Error("failed to initialize PDF store", "error", err)
		os.Exit(1)
	}

	redisClient := redis.NewClient(&redis.Options{Addr: cfg.Redis.Addr, Password: cfg.Redis.Password, DB: cfg.Redis.DB})
	defer func() { _ = redisClient.Close() }()
	// Not fatal: a Redis outage at boot shouldn't crash-loop the service. Every message checks
	// dedupe first and is retried (not sent, not dropped) until Redis answers.
	pingCtx, cancelPing := context.WithTimeout(ctx, 3*time.Second)
	if err := redisClient.Ping(pingCtx).Err(); err != nil {
		slog.Warn("dedupe store (Redis) not reachable yet; messages will wait for it", "addr", cfg.Redis.Addr, "error", err)
	}
	cancelPing()

	invoiceHandler := handler.NewInvoiceHandler(sender, pdfs, dedupe.NewRedisStore(redisClient))
	consumer := kafka.NewConsumer(cfg.KafkaBrokers, cfg.KafkaConsumerGroup, cfg.KafkaTopic, cfg.KafkaDLQTopic)
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
		"kafkaDLQTopic", cfg.KafkaDLQTopic,
		"s3Bucket", cfg.S3.Bucket,
	)

	if err := consumer.Run(ctx, invoiceHandler.Handle); err != nil {
		slog.Error("consumer loop exited with error", "error", err)
		os.Exit(1)
	}

	slog.Info("mail service shut down cleanly")
}

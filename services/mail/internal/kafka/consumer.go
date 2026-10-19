// Package kafka runs the consumer loop: fetch a message, hand it to the handler, and only then
// commit its offset.
package kafka

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	segmentio "github.com/segmentio/kafka-go"

	"einvoice/mail/internal/failure"
)

// Handler processes one message. nil = done (commit); failure.Permanent = can never succeed
// (dead-letter, then commit); any other error = retry the same message.
type Handler func(ctx context.Context, key, value []byte) error

type reader interface {
	FetchMessage(ctx context.Context) (segmentio.Message, error)
	CommitMessages(ctx context.Context, msgs ...segmentio.Message) error
	Close() error
}

type writer interface {
	WriteMessages(ctx context.Context, msgs ...segmentio.Message) error
	Close() error
}

// RetryPolicy is the capped exponential backoff between attempts at one message (and between
// dead-letter writes).
type RetryPolicy struct {
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

var DefaultRetryPolicy = RetryPolicy{InitialBackoff: time.Second, MaxBackoff: time.Minute}

// After this many consecutive failures on one message the warnings become errors: something is
// down, and invoice emails for this partition are queuing behind it.
const escalateAfterAttempts = 5

// readRetryBackoff spaces out retries of the fetch itself (broker not ready, rebalance, ...).
const readRetryBackoff = 5 * time.Second

// commitTimeout bounds the offset commit after a message succeeded. It runs even if shutdown has
// begun: the work is done, and committing avoids a redelivery (which dedupe would absorb anyway).
const commitTimeout = 5 * time.Second

// Dead-letter message headers.
const (
	HeaderError             = "x-error"
	HeaderOriginalTopic     = "x-original-topic"
	HeaderOriginalPartition = "x-original-partition"
	HeaderOriginalOffset    = "x-original-offset"
	HeaderAttempts          = "x-attempts"
	HeaderDeadLetteredAt    = "x-dead-lettered-at"
)

// Consumer delivers each message to the handler at least once:
//
//   - The offset is committed only after the handler succeeded or the message was dead-lettered, so
//     a crash or shutdown mid-message means it is redelivered, never skipped.
//   - A transient failure is retried in place with backoff. That holds up the rest of this
//     partition, deliberately: messages stay in order, and an SMTP outage delays invoice emails
//     instead of losing them.
//   - A permanent failure is written to the dead-letter topic with the error and its origin in
//     headers, then committed -- kept for inspection and replay, and never blocking the partition.
type Consumer struct {
	reader reader
	dlq    writer
	retry  RetryPolicy
	sleep  func(ctx context.Context, d time.Duration) bool
}

func NewConsumer(brokers []string, groupID, topic, dlqTopic string) *Consumer {
	return newConsumer(
		segmentio.NewReader(segmentio.ReaderConfig{
			Brokers: brokers,
			GroupID: groupID,
			Topic:   topic,
			// Explicit, synchronous commits (CommitMessages), never commit-on-read.
			CommitInterval: 0,
		}),
		&segmentio.Writer{
			Addr:                   segmentio.TCP(brokers...),
			Topic:                  dlqTopic,
			Balancer:               &segmentio.Hash{}, // same key, same partition, as on the source topic
			RequiredAcks:           segmentio.RequireAll,
			AllowAutoTopicCreation: true,
		},
		DefaultRetryPolicy,
	)
}

func newConsumer(r reader, dlq writer, retry RetryPolicy) *Consumer {
	return &Consumer{reader: r, dlq: dlq, retry: retry, sleep: sleepCtx}
}

// Run blocks until ctx is cancelled (wired to SIGTERM/SIGINT). Only cancellation ends the loop; a
// fetch error -- e.g. "Group Coordinator Not Available" from a freshly started single-node broker --
// is logged and retried.
func (c *Consumer) Run(ctx context.Context, handle Handler) error {
	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			slog.Error("failed to fetch message, retrying", "error", err, "backoff", readRetryBackoff)
			if !c.sleep(ctx, readRetryBackoff) {
				return nil
			}
			continue
		}

		if !c.process(ctx, msg, handle) {
			return nil
		}
	}
}

func (c *Consumer) Close() error {
	return errors.Join(c.reader.Close(), c.dlq.Close())
}

// process returns false only when ctx was cancelled before the message was finished with; it is
// then left uncommitted, to be redelivered after restart.
func (c *Consumer) process(ctx context.Context, msg segmentio.Message, handle Handler) bool {
	log := slog.With("topic", msg.Topic, "partition", msg.Partition, "offset", msg.Offset)

	for attempt := 1; ; attempt++ {
		err := handle(ctx, msg.Key, msg.Value)
		if err == nil {
			c.commit(ctx, msg)
			return true
		}
		if ctx.Err() != nil {
			return false
		}

		if failure.IsPermanent(err) {
			log.Error("message can never be processed; dead-lettering", "error", err, "attempts", attempt)
			if !c.deadLetter(ctx, msg, err, attempt) {
				return false
			}
			c.commit(ctx, msg)
			return true
		}

		delay := c.backoff(attempt)
		if attempt >= escalateAfterAttempts {
			log.Error("message still failing; retrying", "error", err, "attempt", attempt, "backoff", delay)
		} else {
			log.Warn("message failed; retrying", "error", err, "attempt", attempt, "backoff", delay)
		}
		if !c.sleep(ctx, delay) {
			return false
		}
	}
}

// deadLetter keeps trying until the dead-letter write succeeds: the source offset must not be
// committed while the message exists nowhere else.
func (c *Consumer) deadLetter(ctx context.Context, msg segmentio.Message, cause error, attempts int) bool {
	dead := segmentio.Message{
		Key:   msg.Key,
		Value: msg.Value,
		Headers: append(append([]segmentio.Header(nil), msg.Headers...),
			segmentio.Header{Key: HeaderError, Value: []byte(cause.Error())},
			segmentio.Header{Key: HeaderOriginalTopic, Value: []byte(msg.Topic)},
			segmentio.Header{Key: HeaderOriginalPartition, Value: []byte(strconv.Itoa(msg.Partition))},
			segmentio.Header{Key: HeaderOriginalOffset, Value: []byte(strconv.FormatInt(msg.Offset, 10))},
			segmentio.Header{Key: HeaderAttempts, Value: []byte(strconv.Itoa(attempts))},
			segmentio.Header{Key: HeaderDeadLetteredAt, Value: []byte(time.Now().UTC().Format(time.RFC3339))},
		),
	}

	for attempt := 1; ; attempt++ {
		err := c.dlq.WriteMessages(ctx, dead)
		if err == nil {
			return true
		}
		if ctx.Err() != nil {
			return false
		}
		delay := c.backoff(attempt)
		slog.Error("failed to write dead letter; retrying", "error", err, "attempt", attempt, "backoff", delay,
			"topic", msg.Topic, "partition", msg.Partition, "offset", msg.Offset)
		if !c.sleep(ctx, delay) {
			return false
		}
	}
}

func (c *Consumer) commit(ctx context.Context, msg segmentio.Message) {
	commitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), commitTimeout)
	defer cancel()
	if err := c.reader.CommitMessages(commitCtx, msg); err != nil {
		// Not fatal: the message will be redelivered, and handlers dedupe on eventId.
		slog.Error("failed to commit offset; message may be redelivered", "error", err,
			"topic", msg.Topic, "partition", msg.Partition, "offset", msg.Offset)
	}
}

func (c *Consumer) backoff(attempt int) time.Duration {
	delay := c.retry.InitialBackoff
	for i := 1; i < attempt && delay < c.retry.MaxBackoff; i++ {
		delay *= 2
	}
	return min(delay, c.retry.MaxBackoff)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

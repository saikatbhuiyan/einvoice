// Package kafka wraps segmentio/kafka-go's Reader into a simple consume loop. Chosen over
// confluent-kafka-go specifically for this: it's pure Go (no cgo/librdkafka), which keeps the
// final binary statically linked and the Docker image genuinely small -- see the Dockerfile.
package kafka

import (
	"context"
	"errors"
	"log/slog"
	"time"

	segmentio "github.com/segmentio/kafka-go"
)

const readRetryBackoff = 3 * time.Second

// Handler processes one decoded message. Returning an error logs it and moves on to the next
// message -- a single malformed or unprocessable event must never take down the whole consumer,
// the same "log and continue" discipline apps/payment's webhook handler already applies to an
// unrecognized Stripe event type.
type Handler func(ctx context.Context, key, value []byte) error

type Consumer struct {
	reader *segmentio.Reader
}

func NewConsumer(brokers []string, groupID, topic string) *Consumer {
	reader := segmentio.NewReader(segmentio.ReaderConfig{
		Brokers: brokers,
		GroupID: groupID,
		Topic:   topic,
	})
	return &Consumer{reader: reader}
}

// Run blocks until ctx is cancelled (the caller wires that to SIGTERM/SIGINT for graceful
// shutdown). A read error -- e.g. "Group Coordinator Not Available", seen for real against a
// freshly started single-node broker whose internal __consumer_offsets topic hadn't finished
// initializing yet -- is logged and retried after a backoff rather than treated as fatal; a
// broker that's transiently not ready is exactly the case this loop needs to tolerate, not crash
// over. Only ctx cancellation ends the loop.
func (c *Consumer) Run(ctx context.Context, handle Handler) error {
	for {
		msg, err := c.reader.ReadMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			slog.Error("failed to read message, retrying", "error", err, "backoff", readRetryBackoff)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(readRetryBackoff):
			}
			continue
		}

		if err := handle(ctx, msg.Key, msg.Value); err != nil {
			slog.Error("failed to process message", "topic", msg.Topic, "partition", msg.Partition, "offset", msg.Offset, "error", err)
			// ReadMessage already committed this offset; deliberately not retrying it forever --
			// a message this handler can't process (bad JSON, unknown type) will never succeed on
			// retry either. Logged for a human to notice, not silently dropped.
			continue
		}
	}
}

func (c *Consumer) Close() error {
	return c.reader.Close()
}

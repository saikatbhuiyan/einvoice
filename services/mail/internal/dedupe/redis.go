// Package dedupe remembers which events were already acted on. Every invoice event is delivered
// at least once (outbox relay retries, consumer redelivery after a crash before commit), so
// without this a client could receive the same invoice email twice.
package dedupe

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Store is the DI seam the handler checks through.
type Store interface {
	// Seen reports whether eventID was already processed. An error means "unknown": the caller
	// must not act (retry later), or it risks a duplicate.
	Seen(ctx context.Context, eventID string) (bool, error)
	// Mark records eventID as processed. Called after the side effect succeeded.
	Mark(ctx context.Context, eventID string) error
}

// Retention comfortably exceeds how long a duplicate can still arrive (Kafka retention for a
// redelivery; the outbox keeps published rows for 7 days).
const Retention = 7 * 24 * time.Hour

const keyPrefix = "mail:sent:"

type RedisStore struct {
	client redis.UniversalClient
}

func NewRedisStore(client redis.UniversalClient) *RedisStore {
	return &RedisStore{client: client}
}

func (s *RedisStore) Seen(ctx context.Context, eventID string) (bool, error) {
	err := s.client.Get(ctx, keyPrefix+eventID).Err()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check dedupe key for event %s: %w", eventID, err)
	}
	return true, nil
}

func (s *RedisStore) Mark(ctx context.Context, eventID string) error {
	if err := s.client.Set(ctx, keyPrefix+eventID, time.Now().UTC().Format(time.RFC3339), Retention).Err(); err != nil {
		return fmt.Errorf("record dedupe key for event %s: %w", eventID, err)
	}
	return nil
}

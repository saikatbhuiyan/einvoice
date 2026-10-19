//go:build integration

package dedupe

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func TestRedisStoreAgainstRealRedis(t *testing.T) {
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start redis: %v", err)
	}
	uri, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	opts, err := redis.ParseURL(uri)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	client := redis.NewClient(opts)
	t.Cleanup(func() { _ = client.Close() })
	store := NewRedisStore(client)

	seen, err := store.Seen(ctx, "evt-1")
	if err != nil || seen {
		t.Fatalf("Seen before Mark = %v, %v; want false, nil", seen, err)
	}
	if err := store.Mark(ctx, "evt-1"); err != nil {
		t.Fatalf("Mark: %v", err)
	}
	if seen, err := store.Seen(ctx, "evt-1"); err != nil || !seen {
		t.Fatalf("Seen after Mark = %v, %v; want true, nil", seen, err)
	}
	if seen, _ := store.Seen(ctx, "evt-2"); seen {
		t.Fatal("marking one event must not mark another")
	}

	ttl := client.TTL(ctx, "mail:sent:evt-1").Val()
	if ttl < Retention-time.Minute || ttl > Retention {
		t.Fatalf("TTL = %v, want ~%v (expires, so the keyspace doesn't grow forever)", ttl, Retention)
	}

	// "Unknown" must surface as an error, never as "not seen" (which would risk a duplicate email).
	down := NewRedisStore(redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 500 * time.Millisecond}))
	if _, err := down.Seen(ctx, "evt-1"); err == nil {
		t.Fatal("Seen against an unreachable Redis must return an error")
	}
}

//go:build integration

package storage

import (
	"bytes"
	"context"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"einvoice/mail/internal/failure"
)

// Against adobe/s3mock, the S3 emulator dev compose runs (same pinned version as apps/media's
// integration test).
func TestS3StoreAgainstS3Mock(t *testing.T) {
	ctx := context.Background()
	container, err := testcontainers.Run(ctx, "adobe/s3mock:5.2.3",
		testcontainers.WithExposedPorts("9090/tcp"),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/favicon.ico").WithPort("9090/tcp")),
	)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start s3mock: %v", err)
	}
	endpoint, err := container.PortEndpoint(ctx, "9090/tcp", "http")
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}

	store, err := NewS3Store(ctx, S3Config{
		Bucket: "einvoice-int", Region: "us-east-1", Endpoint: endpoint, ForcePathStyle: true,
		AccessKeyID: "test", SecretAccessKey: "test",
	})
	if err != nil {
		t.Fatalf("NewS3Store: %v", err)
	}
	if _, err := store.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String("einvoice-int")}); err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	// The key shape apps/media writes, including characters that come from an invoice number.
	key := "invoices/2b6f0c2e/invoice-INV #42?draft.pdf"
	body := []byte("%PDF-1.7\n\xff binary bytes")
	if _, err := store.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String("einvoice-int"), Key: aws.String(key), Body: bytes.NewReader(body),
	}); err != nil {
		t.Fatalf("put object: %v", err)
	}

	t.Run("reads the exact bytes by key", func(t *testing.T) {
		got, err := store.Get(ctx, key)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if !bytes.Equal(got, body) {
			t.Fatalf("Get returned %q, want %q", got, body)
		}
	})

	t.Run("a missing object is permanent", func(t *testing.T) {
		_, err := store.Get(ctx, "invoices/never/uploaded.pdf")
		if err == nil || !failure.IsPermanent(err) {
			t.Fatalf("err = %v, want a permanent not-found error", err)
		}
	})

	t.Run("an unreachable store is transient", func(t *testing.T) {
		down, err := NewS3Store(ctx, S3Config{
			Bucket: "einvoice-int", Region: "us-east-1", Endpoint: fmt.Sprintf("http://127.0.0.1:%d", 1),
			ForcePathStyle: true, AccessKeyID: "test", SecretAccessKey: "test",
		})
		if err != nil {
			t.Fatalf("NewS3Store: %v", err)
		}
		if _, err := down.Get(ctx, key); err == nil || failure.IsPermanent(err) {
			t.Fatalf("err = %v, want a transient error", err)
		}
	})
}

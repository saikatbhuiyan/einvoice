// Package storage reads the invoice PDFs that apps/media wrote to the (private) bucket. The
// invoice.sent event carries the object key, never a URL: a presigned URL could expire before a
// lagging or retrying consumer got to it.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"einvoice/mail/internal/failure"
)

// PDFStore is the DI seam the handler reads PDFs through (same shape as mail.Sender).
type PDFStore interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

type S3Config struct {
	Bucket         string
	Region         string
	Endpoint       string // s3mock in dev; empty for AWS
	ForcePathStyle bool
	// Static keys for dev only. Left empty in production, so the SDK's default chain (an ECS task
	// role / instance profile with s3:GetObject on the bucket) is used -- same posture as SES here
	// and apps/media's S3 client.
	AccessKeyID     string
	SecretAccessKey string
}

type S3Store struct {
	bucket string
	client *s3.Client
}

func NewS3Store(ctx context.Context, cfg S3Config) (*S3Store, error) {
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(cfg.Region)}
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		opts = append(opts, awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.ForcePathStyle
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
	})
	return &S3Store{bucket: cfg.Bucket, client: client}, nil
}

// Get returns the object's bytes. A missing object is permanent -- it won't appear on retry -- while
// everything else (network, throttling, 5xx, and access denied, which is a permissions problem that
// affects every message) is transient.
func (s *S3Store) Get(ctx context.Context, key string) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		err = fmt.Errorf("get s3://%s/%s: %w", s.bucket, key, err)
		if isNotFound(err) {
			return nil, failure.Permanent(err)
		}
		return nil, err
	}
	defer out.Body.Close()

	body, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, fmt.Errorf("read s3://%s/%s: %w", s.bucket, key, err)
	}
	return body, nil
}

func isNotFound(err error) bool {
	var noSuchKey *types.NoSuchKey
	if errors.As(err, &noSuchKey) {
		return true
	}
	var respErr *awshttp.ResponseError
	return errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound
}

package mail

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"

	"einvoice/mail/internal/failure"
)

type SESSender struct {
	from   string
	client *sesv2.Client
}

// NewSESSender uses the AWS SDK's own default credential chain (env vars, shared config, or --
// the production case -- an ECS task role / EC2 instance profile) rather than requiring static
// keys in config, the same IAM-role-friendly posture already established for S3 in
// apps/media/src/app/modules/media/s3-storage.provider.ts.
func NewSESSender(ctx context.Context, region, from string) (*SESSender, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}

	return &SESSender{from: from, client: sesv2.NewFromConfig(cfg)}, nil
}

func (s *SESSender) Send(ctx context.Context, msg Message) error {
	// SES's "Simple" content type has no attachment support -- Raw is the only content type
	// that does, so both providers end up building the same raw MIME message either way.
	raw, err := buildRaw(s.from, msg)
	if err != nil {
		return failure.Permanent(err)
	}

	_, err = s.client.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(s.from),
		Destination:      &types.Destination{ToAddresses: []string{msg.To}},
		Content: &types.EmailContent{
			Raw: &types.RawMessage{Data: raw},
		},
	})
	if err != nil {
		err = fmt.Errorf("send via SES: %w", err)
		if isPermanentSESError(err) {
			return failure.Permanent(err)
		}
		return err
	}
	return nil
}

// isPermanentSESError: SES refused *this* message (its content or recipient). Account-wide refusals
// -- unverified sending domain, suspended or paused account, throttling -- are left transient: every
// message would fail, so delivery should pause until they're fixed rather than dead-letter them all.
func isPermanentSESError(err error) bool {
	var rejected *types.MessageRejected
	var badRequest *types.BadRequestException
	return errors.As(err, &rejected) || errors.As(err, &badRequest)
}

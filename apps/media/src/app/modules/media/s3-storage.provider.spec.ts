import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3Config = {
  S3_BUCKET: 'einvoice-media',
  S3_REGION: 'eu-west-1',
  S3_ENDPOINT: undefined as string | undefined,
  S3_ACCESS_KEY_ID: undefined as string | undefined,
  S3_SECRET_ACCESS_KEY: undefined as string | undefined,
  S3_FORCE_PATH_STYLE: false,
  S3_PUBLIC_BASE_URL: undefined as string | undefined,
};

// The real CONFIGURATION validates eagerly at import time against process.env; the provider only
// reads S3_CONFIG, so that's all this replaces.
jest.mock('../../../configuration', () => ({ CONFIGURATION: { S3_CONFIG: s3Config } }));

// Records the config each S3Client is constructed with. Resolving credentials instead would go
// through the SDK's default chain and depend on whatever ~/.aws or env the test machine has.
const mockConstructedWith: Array<Record<string, unknown>> = [];
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  class RecordingS3Client extends actual.S3Client {
    constructor(config: Record<string, unknown>) {
      super(config);
      mockConstructedWith.push(config);
    }
  }
  return { ...actual, S3Client: RecordingS3Client };
});

import { S3StorageProvider } from './s3-storage.provider';

describe('S3StorageProvider', () => {
  let send: jest.SpyInstance;

  beforeEach(() => {
    Object.assign(s3Config, {
      S3_PUBLIC_BASE_URL: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });
    send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('puts the object into the configured bucket with its content type', async () => {
    const body = Buffer.from('%PDF-1.7');

    await new S3StorageProvider().upload({ key: 'invoices/1-a.pdf', body, contentType: 'application/pdf' });

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'einvoice-media',
      Key: 'invoices/1-a.pdf',
      Body: body,
      ContentType: 'application/pdf',
    });
  });

  it('returns a virtual-hosted AWS URL when no public base URL is configured', async () => {
    const result = await new S3StorageProvider().upload({
      key: 'invoices/1-a.pdf',
      body: Buffer.alloc(0),
      contentType: 'x',
    });

    expect(result).toEqual({
      key: 'invoices/1-a.pdf',
      url: 'https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1-a.pdf',
    });
  });

  it('uses S3_PUBLIC_BASE_URL when set, tolerating a trailing slash', async () => {
    s3Config.S3_PUBLIC_BASE_URL = 'http://localhost:9090/einvoice-media/';

    const { url } = await new S3StorageProvider().upload({
      key: 'invoices/1-a.pdf',
      body: Buffer.alloc(0),
      contentType: 'x',
    });

    expect(url).toBe('http://localhost:9090/einvoice-media/invoices/1-a.pdf');
  });

  // The key embeds the invoice number, which is only length-validated — "INV #42" is legal. This
  // URL is stored on the invoice and emailed to the customer, so it must survive URL parsing.
  it('percent-encodes key segments so characters like "#", "?" and spaces cannot truncate the URL', async () => {
    const key = 'invoices/1-invoice-INV #42?draft=1.pdf';

    const { url, key: returnedKey } = await new S3StorageProvider().upload({
      key,
      body: Buffer.alloc(0),
      contentType: 'x',
    });

    expect(returnedKey).toBe(key);
    expect(url).toBe(
      'https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1-invoice-INV%20%2342%3Fdraft%3D1.pdf',
    );
    expect(new URL(url).pathname).toBe('/invoices/1-invoice-INV%20%2342%3Fdraft%3D1.pdf');
  });

  it('checks health with HeadBucket against the configured bucket', async () => {
    await new S3StorageProvider().checkHealth();

    const command = send.mock.calls[0][0] as HeadBucketCommand;
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'einvoice-media' });
  });

  it('propagates an S3 failure from health checks so readiness reports it', async () => {
    send.mockRejectedValue(new Error('AccessDenied'));

    await expect(new S3StorageProvider().checkHealth()).rejects.toThrow('AccessDenied');
  });

  // No credentials property at all (not undefined keys) lets the SDK use its default provider
  // chain — the IAM-role posture production relies on.
  it('omits the credentials property entirely when no static keys are configured', () => {
    new S3StorageProvider();

    expect('credentials' in mockConstructedWith[mockConstructedWith.length - 1]).toBe(false);
  });

  it('omits credentials when only one of key id / secret is set', () => {
    s3Config.S3_ACCESS_KEY_ID = 'AKIA-TEST';
    new S3StorageProvider();

    expect('credentials' in mockConstructedWith[mockConstructedWith.length - 1]).toBe(false);
  });

  it('passes static credentials when both key id and secret are set', () => {
    Object.assign(s3Config, { S3_ACCESS_KEY_ID: 'AKIA-TEST', S3_SECRET_ACCESS_KEY: 'secret' });
    new S3StorageProvider();

    expect(mockConstructedWith[mockConstructedWith.length - 1]['credentials']).toEqual({
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
    });
  });
});

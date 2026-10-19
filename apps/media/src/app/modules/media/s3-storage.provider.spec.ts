import { NotFoundException } from '@nestjs/common';
import { HeadBucketCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3Config = {
  S3_BUCKET: 'einvoice-media',
  S3_REGION: 'eu-west-1',
  S3_ENDPOINT: undefined as string | undefined,
  S3_ACCESS_KEY_ID: undefined as string | undefined,
  S3_SECRET_ACCESS_KEY: undefined as string | undefined,
  S3_FORCE_PATH_STYLE: false,
  S3_PUBLIC_ENDPOINT: undefined as string | undefined,
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

import { S3StorageProvider, contentDisposition } from './s3-storage.provider';

describe('S3StorageProvider', () => {
  let send: jest.SpyInstance;

  beforeEach(() => {
    Object.assign(s3Config, {
      S3_ENDPOINT: undefined,
      S3_PUBLIC_ENDPOINT: undefined,
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

  it('returns only the key -- no permanent URL to a private object', async () => {
    const result = await new S3StorageProvider().upload({
      key: 'invoices/u/a.pdf',
      body: Buffer.alloc(0),
      contentType: 'x',
    });

    expect(result).toEqual({ key: 'invoices/u/a.pdf' });
  });

  describe('getDownloadUrl', () => {
    beforeEach(() => {
      // Presigning is offline, but needs credentials to sign with.
      Object.assign(s3Config, {
        S3_ACCESS_KEY_ID: 'AKIA-TEST',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_ENDPOINT: 'http://s3mock:9090',
        S3_PUBLIC_ENDPOINT: 'http://localhost:9090',
        S3_FORCE_PATH_STYLE: true,
      });
    });

    // The service reaches S3 at an in-network host; the browser can't. The signature covers the host,
    // so the URL must be *signed* for the public one, not rewritten after the fact.
    it('checks the object exists via the internal endpoint, then signs for the public endpoint', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-19T10:00:00.000Z') });
      try {
        const { url, expiresAt } = await new S3StorageProvider().getDownloadUrl({
          key: 'invoices/u/invoice-INV-1.pdf',
          fileName: 'invoice-INV-1.pdf',
          expiresInSeconds: 300,
        });

        const head = send.mock.calls[0][0] as HeadObjectCommand;
        expect(head).toBeInstanceOf(HeadObjectCommand);
        expect(head.input).toEqual({ Bucket: 'einvoice-media', Key: 'invoices/u/invoice-INV-1.pdf' });

        const parsed = new URL(url);
        expect(parsed.origin).toBe('http://localhost:9090');
        expect(parsed.pathname).toBe('/einvoice-media/invoices/u/invoice-INV-1.pdf');
        expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
        expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
        expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
        expect(parsed.searchParams.get('response-content-disposition')).toBe(contentDisposition('invoice-INV-1.pdf'));
        expect(expiresAt).toEqual(new Date('2026-10-19T10:05:00.000Z'));
      } finally {
        jest.useRealTimers();
      }
    });

    it('signs for the regular endpoint when no public endpoint is configured (AWS)', async () => {
      Object.assign(s3Config, { S3_ENDPOINT: undefined, S3_PUBLIC_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: false });

      const { url } = await new S3StorageProvider().getDownloadUrl({
        key: 'k.pdf',
        fileName: 'k.pdf',
        expiresInSeconds: 60,
      });

      expect(new URL(url).host).toBe('einvoice-media.s3.eu-west-1.amazonaws.com');
    });

    it('throws NotFoundException instead of handing out a link to a missing object', async () => {
      send.mockRejectedValue(new NotFound({ message: 'Not Found', $metadata: {} }));

      await expect(
        new S3StorageProvider().getDownloadUrl({ key: 'gone.pdf', fileName: 'gone.pdf', expiresInSeconds: 60 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates any other S3 failure', async () => {
      send.mockRejectedValue(new Error('AccessDenied'));

      await expect(
        new S3StorageProvider().getDownloadUrl({ key: 'k.pdf', fileName: 'k.pdf', expiresInSeconds: 60 }),
      ).rejects.toThrow('AccessDenied');
    });
  });

  // The file name derives from the user-supplied invoice number.
  describe('contentDisposition', () => {
    it('keeps a plain name as-is', () => {
      expect(contentDisposition('invoice-INV-1.pdf')).toBe(
        `attachment; filename="invoice-INV-1.pdf"; filename*=UTF-8''invoice-INV-1.pdf`,
      );
    });

    it('cannot be broken out of by quotes or backslashes, and carries non-ASCII names exactly in filename*', () => {
      expect(contentDisposition('INV "x"\\ é.pdf')).toBe(
        `attachment; filename="INV _x__ _.pdf"; filename*=UTF-8''INV%20%22x%22%5C%20%C3%A9.pdf`,
      );
    });
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

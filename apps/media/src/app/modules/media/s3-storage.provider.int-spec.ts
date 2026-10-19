import { NotFoundException } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const BUCKET = 'einvoice-int';
const s3Config: Record<string, unknown> = {};

jest.mock('../../../configuration', () => ({ CONFIGURATION: { S3_CONFIG: s3Config } }));

import { S3StorageProvider } from './s3-storage.provider';

/**
 * Integration test: S3StorageProvider against adobe/s3mock (the same S3 emulator the dev compose
 * stack runs). Download URLs are handed to browsers, so the test actually fetches them.
 *
 * s3mock does not verify request signatures, so expiry and tampering can't be proven here -- the
 * unit spec pins what is signed (host, expiry, disposition); enforcement is S3's.
 */
describe('S3StorageProvider against s3mock', () => {
  let container: StartedTestContainer;
  let endpoint: string;
  let provider: S3StorageProvider;

  beforeAll(async () => {
    container = await new GenericContainer('adobe/s3mock:5.2.3')
      .withExposedPorts(9090)
      .withWaitStrategy(Wait.forHttp('/favicon.ico', 9090))
      .start();
    endpoint = `http://${container.getHost()}:${container.getMappedPort(9090)}`;

    Object.assign(s3Config, {
      S3_BUCKET: BUCKET,
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: endpoint,
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_PUBLIC_ENDPOINT: endpoint,
    });
    await new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }).send(new CreateBucketCommand({ Bucket: BUCKET }));

    provider = new S3StorageProvider();
  });

  afterAll(async () => {
    await container?.stop();
  });

  it('reports healthy once the bucket exists', async () => {
    await expect(provider.checkHealth()).resolves.toBeUndefined();
  });

  it('stores the exact bytes with the given content type', async () => {
    const body = Buffer.from('%PDF-1.7\nÿ binary bytes');

    const { key } = await provider.upload({ key: 'invoices/1-plain.pdf', body, contentType: 'application/pdf' });

    const client = (provider as unknown as { client: S3Client }).client;
    const object = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    expect(object.ContentType).toBe('application/pdf');
    expect(Buffer.from(await object.Body!.transformToByteArray()).equals(body)).toBe(true);
  });

  // An invoice number like "INV #42" ends up in the key and file name; the presigned URL must still
  // fetch exactly that object, and the browser must save it under the original name.
  it('serves the object through a presigned URL, even with #, ? and spaces in the key', async () => {
    const body = Buffer.from('invoice bytes');
    const { key } = await provider.upload({
      key: 'invoices/u/invoice-INV #42?draft.pdf',
      body,
      contentType: 'application/pdf',
    });

    const { url, expiresAt } = await provider.getDownloadUrl({
      key,
      fileName: 'invoice-INV #42?draft.pdf',
      expiresInSeconds: 120,
    });

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="invoice-INV #42?draft.pdf"; filename*=UTF-8''invoice-INV%20%2342%3Fdraft.pdf`,
    );
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to sign a URL for an object that does not exist', async () => {
    await expect(
      provider.getDownloadUrl({ key: 'invoices/u/never-uploaded.pdf', fileName: 'x.pdf', expiresInSeconds: 60 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports unhealthy when the bucket does not exist', async () => {
    s3Config['S3_BUCKET'] = 'missing-bucket';
    try {
      await expect(provider.checkHealth()).rejects.toThrow();
    } finally {
      s3Config['S3_BUCKET'] = BUCKET;
    }
  });
});

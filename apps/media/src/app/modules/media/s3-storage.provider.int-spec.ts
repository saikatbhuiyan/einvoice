import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const BUCKET = 'einvoice-int';
const s3Config: Record<string, unknown> = {};

jest.mock('../../../configuration', () => ({ CONFIGURATION: { S3_CONFIG: s3Config } }));

import { S3StorageProvider } from './s3-storage.provider';

/**
 * Integration test: S3StorageProvider against adobe/s3mock (the same S3 emulator the dev compose
 * stack runs). The URL it returns is emailed to customers, so the test actually fetches it.
 */
describe('S3StorageProvider against s3mock', () => {
  let container: StartedTestContainer;
  let endpoint: string;
  let provider: S3StorageProvider;

  beforeAll(async () => {
    container = await new GenericContainer('adobe/s3mock:latest')
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
      S3_PUBLIC_BASE_URL: `${endpoint}/${BUCKET}`,
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

  // The regression the unit spec pins at the string level, verified against a real server: an
  // invoice number like "INV #42" must yield a URL that fetches that object, not a 404.
  it('returns a URL that actually fetches the object, even with #, ? and spaces in the key', async () => {
    const body = Buffer.from('invoice bytes');

    const { url } = await provider.upload({
      key: 'invoices/1-invoice-INV #42?draft.pdf',
      body,
      contentType: 'application/pdf',
    });

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
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

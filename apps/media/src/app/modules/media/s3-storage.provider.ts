import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CONFIGURATION } from '../../../configuration';
import { DownloadUrl, StorageProvider, UploadedObject } from './storage-provider.interface';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  /**
   * Signs download URLs only (never sends a request). A presigned URL embeds the host it was signed
   * for, and the signature covers it, so it must be signed for the endpoint the *downloader* reaches
   * -- in dev that's s3mock's host-published port, not the in-network "s3mock:9090" the service
   * talks to. In AWS both are the regional endpoint, and S3_PUBLIC_ENDPOINT is left unset.
   */
  private readonly presigner: S3Client;

  constructor() {
    const config = CONFIGURATION.S3_CONFIG;

    const base: S3ClientConfig = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      // Omitting `credentials` entirely (not passing it as `undefined` keys on an object -- the
      // SDK checks for the property's presence, not just a truthy value) lets the client fall
      // back to its own default provider chain -- an ECS task role or EC2 instance profile in
      // production, where neither S3_ACCESS_KEY_ID nor S3_SECRET_ACCESS_KEY should be set at all.
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    };

    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.presigner = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT });
  }

  async upload({
    key,
    body,
    contentType,
  }: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<UploadedObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: CONFIGURATION.S3_CONFIG.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return { key };
  }

  async getDownloadUrl({
    key,
    fileName,
    expiresInSeconds,
  }: {
    key: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<DownloadUrl> {
    const bucket = CONFIGURATION.S3_CONFIG.S3_BUCKET;

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (error instanceof NotFound) {
        throw new NotFoundException(`Stored file "${key}" does not exist.`);
      }
      throw error;
    }

    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(fileName),
      }),
      { expiresIn: expiresInSeconds },
    );

    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  // HeadBucket checks both that the endpoint is reachable and that this service's credentials can
  // actually see the bucket -- a fresh connection that can't access the bucket is not "healthy".
  async checkHealth(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: CONFIGURATION.S3_CONFIG.S3_BUCKET }));
  }
}

/**
 * RFC 6266 attachment header. The file name comes from the user-supplied invoice number, so the
 * quoted `filename` is reduced to safe ASCII (no quotes or backslashes to break out of it), and the
 * exact name travels in `filename*` for clients that support it.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

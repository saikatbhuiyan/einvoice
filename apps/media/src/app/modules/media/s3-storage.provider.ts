import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CONFIGURATION } from '../../../configuration';
import { StorageProvider, UploadedObject } from './storage-provider.interface';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor() {
    const config = CONFIGURATION.S3_CONFIG;

    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
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
    });
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
    const config = CONFIGURATION.S3_CONFIG;

    await this.client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return { key, url: this.resolveUrl(key) };
  }

  // S3_PUBLIC_BASE_URL is required in dev (MinIO has no public virtual-hosted DNS to fall back
  // to); real AWS S3 can omit it and fall back to the standard virtual-hosted-style URL.
  private resolveUrl(key: string): string {
    const config = CONFIGURATION.S3_CONFIG;

    if (config.S3_PUBLIC_BASE_URL) {
      return `${config.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    }

    return `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com/${key}`;
  }
}

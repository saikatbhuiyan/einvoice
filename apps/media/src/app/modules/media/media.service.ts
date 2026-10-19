import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  MAX_DOWNLOAD_URL_TTL_SECONDS,
  MIN_DOWNLOAD_URL_TTL_SECONDS,
  type GetDownloadUrlRequest,
  type GetDownloadUrlResponse,
  type UploadFileRequest,
  type UploadFileResponse,
} from '@libs/transports';
import { STORAGE_PROVIDER, StorageProvider } from './storage-provider.interface';

@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * The random segment makes keys unguessable: the file name comes from the user-supplied invoice
   * number, so a key built from it plus a timestamp could be enumerated. The bucket is private
   * regardless; this is defense in depth, and it keeps two uploads in the same millisecond apart.
   */
  async upload(request: UploadFileRequest): Promise<UploadFileResponse> {
    const body = Buffer.from(request.base64, 'base64');
    const key = `invoices/${randomUUID()}/${request.fileName}`;

    return this.storageProvider.upload({ key, body, contentType: request.contentType });
  }

  async getDownloadUrl(request: GetDownloadUrlRequest): Promise<GetDownloadUrlResponse> {
    const expiresInSeconds = Math.min(
      MAX_DOWNLOAD_URL_TTL_SECONDS,
      Math.max(MIN_DOWNLOAD_URL_TTL_SECONDS, Math.floor(request.expiresInSeconds ?? DEFAULT_DOWNLOAD_URL_TTL_SECONDS)),
    );
    const fileName = request.fileName ?? request.key.split('/').pop() ?? request.key;

    const { url, expiresAt } = await this.storageProvider.getDownloadUrl({
      key: request.key,
      fileName,
      expiresInSeconds,
    });
    return { url, expiresAt: expiresAt.toISOString() };
  }
}

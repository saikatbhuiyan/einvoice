import { Inject, Injectable } from '@nestjs/common';
import type { UploadFileRequest, UploadFileResponse } from '@libs/transports';
import { STORAGE_PROVIDER, StorageProvider } from './storage-provider.interface';

@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  async upload(request: UploadFileRequest): Promise<UploadFileResponse> {
    const body = Buffer.from(request.base64, 'base64');
    const key = `invoices/${Date.now()}-${request.fileName}`;

    return this.storageProvider.upload({ key, body, contentType: request.contentType });
  }
}

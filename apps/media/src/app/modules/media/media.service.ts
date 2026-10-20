import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
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

/** Every key an organization's files are stored under. */
const organizationPrefix = (organizationId: string) => `orgs/${organizationId}/`;

/** Keys written before tenancy; every invoice that has one now belongs to the default organization. */
const LEGACY_PREFIX = 'invoices/';

/**
 * Whether `key` belongs to `organizationId`. A literal `..` segment is refused outright: S3 keys
 * aren't paths, but nothing that builds or presigns one should be trusted to agree on that.
 */
function belongsTo(key: string, organizationId: string): boolean {
  if (key.split('/').includes('..')) return false;
  return (
    key.startsWith(organizationPrefix(organizationId)) ||
    (organizationId === DEFAULT_ORGANIZATION_ID && key.startsWith(LEGACY_PREFIX))
  );
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * Stored under the caller's organization, so a download can be checked against it. The random
   * segment makes keys unguessable and keeps two uploads in the same millisecond apart; the bucket
   * is private regardless -- this is defense in depth.
   */
  async upload(request: UploadFileRequest): Promise<UploadFileResponse> {
    const body = Buffer.from(request.base64, 'base64');
    const key = `${organizationPrefix(requireOrganizationId())}invoices/${randomUUID()}/${request.fileName}`;

    return this.storageProvider.upload({ key, body, contentType: request.contentType });
  }

  /**
   * Signs only the caller organization's keys. invoice only ever asks for the key of an invoice it
   * found in that organization; this holds even if a caller got that wrong. Not found, not
   * forbidden: another organization's files don't exist from here.
   */
  async getDownloadUrl(request: GetDownloadUrlRequest): Promise<GetDownloadUrlResponse> {
    if (!belongsTo(request.key, requireOrganizationId())) {
      throw new NotFoundException('No such file.');
    }
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

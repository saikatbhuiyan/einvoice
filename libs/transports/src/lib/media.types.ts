// Payload shapes for MEDIA_PATTERNS. media has no database of its own either — it's a thin,
// stateless wrapper around StorageProvider (S3 in every environment that matters; s3mock standing
// in for S3 in dev), the same "no DB, pure orchestration" shape apps/authorizer already established
// for a different kind of stateless service.
//
// Stored objects are private: callers keep the *key* and ask for a short-lived presigned download
// URL when someone actually needs the file. No permanent URL is ever handed out.

export interface UploadFileRequest {
  fileName: string;
  contentType: string;
  /** Base64-encoded file bytes — TCP payloads are JSON, so a raw Buffer can't cross the wire as-is. */
  base64: string;
}

export interface UploadFileResponse {
  key: string;
}

export interface GetDownloadUrlRequest {
  key: string;
  /** Name the browser saves the file as (Content-Disposition). Defaults to the key's last segment. */
  fileName?: string;
  /** Clamped to [MIN_DOWNLOAD_URL_TTL_SECONDS, MAX_DOWNLOAD_URL_TTL_SECONDS]. */
  expiresInSeconds?: number;
}

export interface GetDownloadUrlResponse {
  url: string;
  /** ISO-8601 instant after which the URL stops working. */
  expiresAt: string;
}

export const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 300;
export const MIN_DOWNLOAD_URL_TTL_SECONDS = 60;
export const MAX_DOWNLOAD_URL_TTL_SECONDS = 3600;

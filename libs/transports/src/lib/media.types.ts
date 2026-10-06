// Payload shapes for MEDIA_PATTERNS.UPLOAD. media has no database of its own either — it's a
// thin, stateless wrapper around StorageProvider (S3 in every environment that matters; MinIO
// standing in for S3 in dev), the same "no DB, pure orchestration" shape apps/authorizer already
// established for a different kind of stateless service.

export interface UploadFileRequest {
  fileName: string;
  contentType: string;
  /** Base64-encoded file bytes — TCP payloads are JSON, so a raw Buffer can't cross the wire as-is. */
  base64: string;
}

export interface UploadFileResponse {
  key: string;
  url: string;
}

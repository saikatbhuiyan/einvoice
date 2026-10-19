export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface UploadedObject {
  key: string;
}

export interface DownloadUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Same "one small interface, one swappable class behind it" shape as PermissionResolver
 * (libs/auth/src/lib/permission-resolver.interface.ts) — S3StorageProvider is the only
 * implementation today, but nothing in MediaController or MediaService knows that; swapping the
 * backing store (local disk for tests, GCS, a different bucket strategy) means adding a class and
 * changing one DI binding in MediaModule, not touching a caller.
 */
export interface StorageProvider {
  upload(params: { key: string; body: Buffer; contentType: string }): Promise<UploadedObject>;

  /**
   * A short-lived URL that downloads the object directly from the store, saved as `fileName`.
   * Throws NotFoundException if the object doesn't exist, rather than handing out a dead link.
   */
  getDownloadUrl(params: { key: string; fileName: string; expiresInSeconds: number }): Promise<DownloadUrl>;

  /** Throws if the backing store isn't reachable/usable. Drives media's readiness endpoint. */
  checkHealth(): Promise<void>;
}

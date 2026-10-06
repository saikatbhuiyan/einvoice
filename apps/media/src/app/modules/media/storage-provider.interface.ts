export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface UploadedObject {
  key: string;
  url: string;
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
}

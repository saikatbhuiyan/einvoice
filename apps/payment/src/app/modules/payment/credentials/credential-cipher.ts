import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const VERSION = 'v1';
const IV_BYTES = 12; // GCM's recommended nonce size
const KEY_BYTES = 32; // AES-256

/** A secret can't be encrypted or decrypted: misconfiguration or tampering, never a caller's mistake. */
export class CredentialCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCipherError';
  }
}

/**
 * Encrypts provider secrets (an organization's SSLCommerz store password) at rest: AES-256-GCM,
 * a fresh random nonce per value, authenticated so a modified ciphertext fails instead of
 * decrypting to garbage.
 *
 * Stored as `v1:<keyId>:<nonce>:<tag>:<ciphertext>` (base64url parts). `keyId` is a short hash of
 * the key, so decrypting with a different key (a rotated or misconfigured PAYMENT_CREDENTIALS_KEY)
 * says exactly that rather than "authentication failed".
 */
export class CredentialCipher {
  readonly keyId: string;
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new CredentialCipherError(
        `The credentials key must be ${KEY_BYTES} bytes, base64-encoded (got ${key.length}).`,
      );
    }
    this.key = key;
    this.keyId = createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, this.keyId, iv, tag, ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new CredentialCipherError('Unrecognised encrypted credential format.');
    }
    const [, keyId, iv, tag, ciphertext] = parts;
    if (keyId !== this.keyId) {
      throw new CredentialCipherError(
        `This credential was encrypted with key ${keyId}; the configured key is ${this.keyId}.`,
      );
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new CredentialCipherError('An encrypted credential failed authentication (modified or corrupt).');
    }
  }
}

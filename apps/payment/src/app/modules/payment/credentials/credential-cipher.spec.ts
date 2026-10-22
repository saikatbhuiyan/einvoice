import { randomBytes } from 'crypto';
import { CredentialCipher, CredentialCipherError } from './credential-cipher';

const KEY = randomBytes(32).toString('base64');

describe('CredentialCipher', () => {
  const cipher = new CredentialCipher(KEY);

  it('round-trips a secret, with a fresh nonce every time', () => {
    const a = cipher.encrypt('acmeltd0abc1234@ssl');
    const b = cipher.encrypt('acmeltd0abc1234@ssl');

    expect(a).not.toBe(b);
    expect(a).not.toContain('acmeltd0abc1234');
    expect(cipher.decrypt(a)).toBe('acmeltd0abc1234@ssl');
    expect(cipher.decrypt(b)).toBe('acmeltd0abc1234@ssl');
  });

  it('refuses a modified ciphertext instead of returning garbage', () => {
    const stored = cipher.encrypt('secret').split(':');
    const body = Buffer.from(stored[4], 'base64url');
    body[0] ^= 0xff;
    stored[4] = body.toString('base64url');

    expect(() => cipher.decrypt(stored.join(':'))).toThrow(/failed authentication/);
  });

  it('says which key a credential needs when the configured key is a different one', () => {
    const stored = cipher.encrypt('secret');
    const other = new CredentialCipher(randomBytes(32).toString('base64'));

    expect(() => other.decrypt(stored)).toThrow(
      `encrypted with key ${cipher.keyId}; the configured key is ${other.keyId}`,
    );
  });

  it.each([
    ['a short key', randomBytes(16).toString('base64')],
    ['nothing', ''],
  ])('refuses %s', (_label, key) => {
    expect(() => new CredentialCipher(key)).toThrow(CredentialCipherError);
  });

  it('refuses something that is not one of its values', () => {
    expect(() => cipher.decrypt('plaintext-password')).toThrow(/Unrecognised/);
  });
});

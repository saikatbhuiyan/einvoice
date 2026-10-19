import { MediaService } from './media.service';
import type { StorageProvider } from './storage-provider.interface';

describe('MediaService', () => {
  let storage: jest.Mocked<StorageProvider>;
  let service: MediaService;

  beforeEach(() => {
    storage = {
      upload: jest.fn().mockImplementation(async ({ key }) => ({ key })),
      getDownloadUrl: jest.fn().mockResolvedValue({
        url: 'https://s3.test/signed',
        expiresAt: new Date('2026-10-19T10:05:00.000Z'),
      }),
      checkHealth: jest.fn(),
    };
    service = new MediaService(storage);
  });

  afterEach(() => jest.restoreAllMocks());

  it('decodes the base64 payload into the exact bytes the caller sent', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

    await service.upload({ fileName: 'a.pdf', contentType: 'application/pdf', base64: bytes.toString('base64') });

    expect(storage.upload.mock.calls[0][0].body.equals(bytes)).toBe(true);
  });

  it('stores under an unguessable invoices/<uuid>/ prefix, so keys never collide or follow the invoice number', async () => {
    const first = await service.upload({ fileName: 'invoice-INV-1.pdf', contentType: 'application/pdf', base64: '' });
    const second = await service.upload({ fileName: 'invoice-INV-1.pdf', contentType: 'application/pdf', base64: '' });

    expect(first.key).toMatch(/^invoices\/[0-9a-f-]{36}\/invoice-INV-1\.pdf$/);
    expect(second.key).not.toBe(first.key);
    expect(first).toEqual({ key: first.key });
  });

  describe('getDownloadUrl', () => {
    it('defaults to a 5-minute URL named after the key, and returns the expiry as ISO', async () => {
      const result = await service.getDownloadUrl({ key: 'invoices/u/invoice-INV-1.pdf' });

      expect(storage.getDownloadUrl).toHaveBeenCalledWith({
        key: 'invoices/u/invoice-INV-1.pdf',
        fileName: 'invoice-INV-1.pdf',
        expiresInSeconds: 300,
      });
      expect(result).toEqual({ url: 'https://s3.test/signed', expiresAt: '2026-10-19T10:05:00.000Z' });
    });

    it.each([
      [5, 60],
      [100_000, 3600],
      [120.9, 120],
    ])('clamps a requested lifetime of %p seconds to %p', async (requested, applied) => {
      await service.getDownloadUrl({ key: 'k.pdf', fileName: 'x.pdf', expiresInSeconds: requested });

      expect(storage.getDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ expiresInSeconds: applied }));
    });
  });

  it('propagates a storage failure to the caller', async () => {
    storage.upload.mockRejectedValue(new Error('S3 503'));

    await expect(service.upload({ fileName: 'a.pdf', contentType: 'x', base64: '' })).rejects.toThrow('S3 503');
  });
});

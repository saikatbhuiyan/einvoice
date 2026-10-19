import { MediaService } from './media.service';
import type { StorageProvider } from './storage-provider.interface';

describe('MediaService', () => {
  let storage: jest.Mocked<StorageProvider>;
  let service: MediaService;

  beforeEach(() => {
    storage = {
      upload: jest.fn().mockImplementation(async ({ key }) => ({ key, url: `https://cdn.test/${key}` })),
      checkHealth: jest.fn(),
    };
    service = new MediaService(storage);
    jest.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('decodes the base64 payload into the exact bytes the caller sent', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

    await service.upload({ fileName: 'a.pdf', contentType: 'application/pdf', base64: bytes.toString('base64') });

    expect(storage.upload.mock.calls[0][0].body.equals(bytes)).toBe(true);
  });

  it('stores under invoices/ with a timestamp prefix so re-generating a PDF never overwrites the previous one', async () => {
    const result = await service.upload({ fileName: 'invoice-INV-1.pdf', contentType: 'application/pdf', base64: '' });

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'invoices/1760000000000-invoice-INV-1.pdf', contentType: 'application/pdf' }),
    );
    expect(result.url).toBe('https://cdn.test/invoices/1760000000000-invoice-INV-1.pdf');
  });

  it('propagates a storage failure to the caller', async () => {
    storage.upload.mockRejectedValue(new Error('S3 503'));

    await expect(service.upload({ fileName: 'a.pdf', contentType: 'x', base64: '' })).rejects.toThrow('S3 503');
  });
});

import { pdfKeyFromUrl } from './pdf-key-from-url';

describe('pdfKeyFromUrl', () => {
  it.each([
    [
      'dev path-style URL (bucket in the path)',
      'http://localhost:9090/einvoice-dev/invoices/1760000000000-invoice-INV-1.pdf',
      'invoices/1760000000000-invoice-INV-1.pdf',
    ],
    [
      'AWS virtual-hosted URL',
      'https://einvoice-media.s3.eu-west-1.amazonaws.com/invoices/1760000000000-invoice-INV-1.pdf',
      'invoices/1760000000000-invoice-INV-1.pdf',
    ],
    // media percent-encoded each segment, so "#", "?" and spaces from the invoice number survived.
    [
      'encoded characters from the invoice number',
      'https://b.s3.eu-west-1.amazonaws.com/invoices/1-invoice-INV%20%2342%3Fdraft.pdf',
      'invoices/1-invoice-INV #42?draft.pdf',
    ],
  ])('recovers the key from a %s', (_, url, key) => {
    expect(pdfKeyFromUrl(url)).toBe(key);
  });

  it.each([
    ['not a URL', 'not a url'],
    ['no invoices/ segment', 'https://b.s3.amazonaws.com/other/x.pdf'],
    ['nothing after invoices/', 'https://b.s3.amazonaws.com/invoices'],
    ['malformed percent-encoding', 'https://b.s3.amazonaws.com/invoices/%E0%A4%A.pdf'],
  ])('returns null for %s instead of guessing', (_, url) => {
    expect(pdfKeyFromUrl(url)).toBeNull();
  });
});

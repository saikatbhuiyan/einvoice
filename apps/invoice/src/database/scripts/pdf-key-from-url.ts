/**
 * Recovers the S3 key from a legacy `pdfUrl`. media built those URLs as either
 * `<S3_PUBLIC_BASE_URL>/<encoded key>` (dev: path-style, so the bucket name is a path segment) or
 * `https://<bucket>.s3.<region>.amazonaws.com/<encoded key>`, with each key segment
 * percent-encoded -- and every key it ever wrote started with `invoices/`. So the key is the decoded
 * path from the first `invoices` segment on. Returns null for anything that doesn't fit, rather than
 * guessing.
 */
export function pdfKeyFromUrl(pdfUrl: string): string | null {
  let segments: string[];
  try {
    segments = new URL(pdfUrl).pathname.split('/');
  } catch {
    return null;
  }

  const start = segments.indexOf('invoices');
  if (start === -1 || start === segments.length - 1) return null;

  try {
    return segments.slice(start).map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

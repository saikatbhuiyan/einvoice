import { Transform } from 'class-transformer';

const STRIP_HTML_RE = /<[^>]*>/g;
const NORMALIZE_WHITESPACE_RE = /\s+/g;

type SanitizeOptions = {
  stripHtml?: boolean;
  normalizeWhitespace?: boolean;
};

export function Sanitize(options: SanitizeOptions = {}) {
  const { stripHtml = true, normalizeWhitespace = true } = options;

  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;

    let sanitized = value.trim();

    if (stripHtml) {
      sanitized = sanitized.replace(STRIP_HTML_RE, '');
    }

    if (normalizeWhitespace) {
      sanitized = sanitized.replace(NORMALIZE_WHITESPACE_RE, ' ').trim();
    }

    return sanitized;
  });
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginationOffsets {
  skip: number;
  take: number;
}

export function toSkipTake({ page, limit }: PaginationOptions): PaginationOffsets {
  return {
    skip: (Math.max(1, page) - 1) * limit,
    take: limit,
  };
}

export function parsePagination(
  raw: Partial<Record<'page' | 'limit', string | number>>,
  defaults: PaginationOptions = { page: 1, limit: 20 },
): PaginationOptions {
  const page = Math.max(1, parseInt(String(raw.page ?? defaults.page), 10) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(String(raw.limit ?? defaults.limit), 10) || defaults.limit));
  return { page, limit };
}

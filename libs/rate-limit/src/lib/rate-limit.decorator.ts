import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  burst?: number;
  rate?: number;
  keyExtractor?: 'ip' | 'apiKey';
}

export const RateLimit = (options?: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options ?? {});

export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

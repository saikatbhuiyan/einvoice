import axios from 'axios';

/**
 * Rate limiting end to end, against the real Redis token bucket. Uses unauthenticated requests to
 * a route the other e2e files don't depend on: the rate limit guard runs before JwtAuthGuard, so a
 * 401 still spends a token.
 */
describe('Rate limiting through bff (e2e)', () => {
  it('shares one bucket across query strings and returns 429 with Retry-After once it is empty', async () => {
    const first = await axios.get('/products', { params: { bust: 0 } });
    const limit = Number(first.headers['x-ratelimit-limit']);
    expect(limit).toBeGreaterThan(0);

    const remaining: number[] = [Number(first.headers['x-ratelimit-remaining'])];
    let limited;
    for (let i = 1; i <= limit * 2 && !limited; i++) {
      const response = await axios.get('/products', { params: { bust: i } });
      if (response.status === 429) limited = response;
      else remaining.push(Number(response.headers['x-ratelimit-remaining']));
    }

    // A fresh bucket per query string would keep `remaining` near the limit forever.
    expect(Math.min(...remaining)).toBeLessThan(limit / 2);
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});

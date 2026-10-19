/**
 * Token-bucket rate limiter, embedded as a string constant rather than read from a
 * sibling .lua file at runtime: webpack's per-app asset copying only covers each app's
 * own src/assets, not files living in a lib, so a runtime fs.readFileSync(__dirname, ...)
 * silently breaks the moment this lib is bundled into an app's dist output.
 *
 * Keys: KEYS[1] = rate limit key
 * Args: ARGV[1] = burst (max tokens), ARGV[2] = rate (tokens per millisecond),
 *       ARGV[3] = current time in ms, or '' to use Redis's own clock (production),
 *       ARGV[4] = cost (usually 1)
 *
 * Time comes from Redis, not from the caller: every bff instance shares this bucket, so each
 * passing its own Date.now() meant clock skew between instances turned into a *negative* refill
 * (one request from a 2s-behind instance cost 5 tokens). Elapsed time is also clamped and
 * last_refill never moves backwards, for explicit timestamps and replica failover.
 * Returns: { allowed (0/1), remaining_tokens, limit_burst, retry_after_ms }
 */
export const RATE_LIMIT_LUA_SCRIPT = `
local key          = KEYS[1]
local burst        = tonumber(ARGV[1])
local rate         = tonumber(ARGV[2])
local now           = tonumber(ARGV[3])
if now == nil then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local cost          = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens     = tonumber(data[1])
local last_refill = tonumber(data[2])

-- Initialize on first request
if tokens == nil then
  tokens = burst
  last_refill = now
end

-- Calculate refill (milliseconds elapsed * rate per ms)
local elapsed = math.max(0, now - last_refill)
local refill = elapsed * rate
tokens = math.min(burst, tokens + refill)
last_refill = math.max(last_refill, now)

-- Check and deduct
if tokens < cost then
  local retry_after = math.ceil((cost - tokens) / rate)
  -- Update even on reject so elapsed time is tracked for next request
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, math.ceil(burst / rate / 1000) + 1)
  return { 0, math.floor(tokens), burst, retry_after }
end

tokens = tokens - cost
redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
redis.call('EXPIRE', key, math.ceil(burst / rate / 1000) + 1)

return { 1, math.floor(tokens), burst, 0 }
`;

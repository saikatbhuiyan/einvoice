-- ratelimit.lua
-- Keys: KEYS[1] = rate limit key
-- Args: ARGV[1] = burst (max tokens), ARGV[2] = rate (tokens per millisecond),
--        ARGV[3] = current time (milliseconds), ARGV[4] = cost (usually 1)
-- Returns: { allowed (0/1), remaining_tokens, limit_burst, retry_after_ms }

local key          = KEYS[1]
local burst        = tonumber(ARGV[1])
local rate         = tonumber(ARGV[2])
local now           = tonumber(ARGV[3])
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
local elapsed = now - last_refill
local refill = elapsed * rate
tokens = math.min(burst, tokens + refill)
last_refill = now

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
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import type Redis from 'ioredis';

// Take the lease if free, or extend it if this holder already has it -- atomically, so two
// holders can never both believe they lead.
const ACQUIRE_OR_RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return 1
end
return 0`;

// Only the holder may release: a lease that expired and was taken by someone else stays theirs.
const RELEASE_IF_HELD = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * A leader lease in Redis: of every process running the same loop, only the current holder does
 * the work. Call `acquireOrRenew()` at the start of each pass -- it takes a free lease or extends one
 * this process already holds -- so the lease must comfortably outlive a pass (`ttlMs`). If the
 * holder dies, the lease expires and another process takes over on its next pass.
 *
 * A lease reduces duplicate work; it is not a lock to build correctness on: a pass that outlives
 * its lease can overlap the next holder's. Work done under it must be idempotent anyway.
 */
export class RedisLease {
  /** Unique per process (host, pid, random), so two replicas on one host never share an identity. */
  readonly holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly redis: Redis,
    readonly key: string,
    private readonly ttlMs: number,
  ) {}

  /** True if this process holds the lease now (taken or extended for another `ttlMs`). */
  async acquireOrRenew(): Promise<boolean> {
    return (await this.redis.eval(ACQUIRE_OR_RENEW, 1, this.key, this.holder, String(this.ttlMs))) === 1;
  }

  /** Gives the lease up if this process holds it, so a successor needn't wait for it to expire. */
  async release(): Promise<void> {
    await this.redis.eval(RELEASE_IF_HELD, 1, this.key, this.holder);
  }
}

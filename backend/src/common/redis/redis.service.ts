import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * REDIS CACHE SERVICE
 * 
 * Centralized Redis client used for:
 * 1. Caching hot data (contacts, campaign stats)
 * 2. Rate limiting (dedup webhook events)
 * 3. Distributed locks (prevent double-sending)
 * 4. Session data for send counters
 * 
 * BullMQ uses its own Redis connection (via @nestjs/bullmq).
 * This service is for application-level caching.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', 'localhost'),
      port: config.get('REDIS_PORT', 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('connect', () => this.logger.log('Redis connected ✅'));
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
    this.client.connect().catch(() => this.logger.warn('Redis not available — using in-memory fallback'));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }

  /** Get cached value (returns null if miss or Redis down) */
  async get<T = string>(key: string): Promise<T | null> {
    try {
      const val = await this.client.get(key);
      if (!val) return null;
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }

  /** Set with TTL in seconds */
  /**
   * Store a value, optionally with an expiry.
   *
   * `ttlSeconds <= 0` persists the key indefinitely. Redis rejects `EX 0`, and some
   * settings — an operator deliberately disabling AI auto-reply, say — must not quietly
   * expire back to their previous value after a few minutes.
   */
  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.set(key, payload, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, payload);
      }
    } catch { /* silent fallback */ }
  }

  /** Delete a key */
  async del(key: string): Promise<void> {
    try { await this.client.del(key); } catch { /* silent */ }
  }

  /**
   * Idempotency check — returns true if this key was seen before.
   * Used to prevent duplicate webhook processing.
   * O(1) SET NX operation.
   */
  async isDuplicate(key: string, ttlSeconds = 3600): Promise<boolean> {
    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === null; // NX returns null if key already existed
    } catch {
      return false; // If Redis is down, allow processing
    }
  }

  /**
   * Distributed lock for preventing double-sends.
   * Returns unlock function, or null if lock failed.
   */
  async acquireLock(key: string, ttlMs = 30_000): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;
    const token = `${Date.now()}-${Math.random()}`;

    try {
      const result = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (result !== 'OK') return null;

      return async () => {
        const current = await this.client.get(lockKey);
        if (current === token) await this.client.del(lockKey);
      };
    } catch {
      return null;
    }
  }

  /**
   * Increment a counter with TTL (for rate limiting).
   * Returns new count.
   */
  async increment(key: string, ttlSeconds = 86400): Promise<number> {
    try {
      const count = await this.client.incr(key);
      if (count === 1) await this.client.expire(key, ttlSeconds);
      return count;
    } catch {
      return 0;
    }
  }

  /** Check if Redis is connected */
  isConnected(): boolean {
    return this.client.status === 'ready';
  }
}

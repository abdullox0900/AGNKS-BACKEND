import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Thin wrapper that never throws on transport failures — callers get `null`
 * instead, so a dead Redis degrades the specific feature (idempotency dedupe,
 * spend tokens) instead of taking the whole API down.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) readonly client: Redis) {}

  async safeGet(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`GET failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async safeSetNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(`SET NX failed for ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async safeSet(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return true;
    } catch (err) {
      this.logger.warn(`SET failed for ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async safeDel(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`DEL failed for ${key}: ${(err as Error).message}`);
    }
  }

  async safeIncr(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      const value = await this.client.incr(key);
      if (value === 1) await this.client.expire(key, ttlSeconds);
      return value;
    } catch (err) {
      this.logger.warn(`INCR failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  isHealthy(): boolean {
    return this.client.status === 'ready';
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppError } from '@agnks/types';
import { RedisService } from '@/infra/redis/redis.service';

const TOKEN_TTL_S = 60;
const TOKEN_GEN_ATTEMPTS = 8;

interface TokenData {
  cardId: string;
}

@Injectable()
export class SpendTokenService {
  private readonly logger = new Logger(SpendTokenService.name);

  constructor(private readonly redis: RedisService) {}

  async issue(cardId: string): Promise<{ code: string; qrPayload: string; expiresAt: string }> {
    for (let i = 0; i < TOKEN_GEN_ATTEMPTS; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const stored = await this.redis.safeSetNx(
        `spend_token:${code}`,
        JSON.stringify({ cardId } satisfies TokenData),
        TOKEN_TTL_S,
      );
      if (stored) {
        return {
          code,
          qrPayload: `AGNKS:${code}`,
          expiresAt: new Date(Date.now() + TOKEN_TTL_S * 1000).toISOString(),
        };
      }
    }
    this.logger.error('Failed to allocate a unique spend token after retries');
    throw new AppError('INTERNAL_ERROR', { reason: 'token_allocation_failed' });
  }

  /** One-time use: the code is deleted the moment a cashier looks it up. */
  async consume(code: string): Promise<string> {
    const raw = await this.redis.safeGet(`spend_token:${code}`);
    if (!raw) {
      throw new AppError('SPEND_TOKEN_INVALID');
    }
    await this.redis.safeDel(`spend_token:${code}`);
    const data = JSON.parse(raw) as TokenData;
    return data.cardId;
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '@agnks/types';
import { RedisService } from '@/infra/redis/redis.service';

const SESSION_TTL_S = 3 * 60;

export interface SpendSession {
  cardId: string;
  cashierId: string;
  stationId: string;
  shiftId: string;
}

@Injectable()
export class SpendSessionService {
  constructor(private readonly redis: RedisService) {}

  async create(session: SpendSession): Promise<{ sessionId: string; expiresAt: string }> {
    const sessionId = randomUUID();
    await this.redis.safeSet(`spend_session:${sessionId}`, JSON.stringify(session), SESSION_TTL_S);
    return { sessionId, expiresAt: new Date(Date.now() + SESSION_TTL_S * 1000).toISOString() };
  }

  async get(sessionId: string): Promise<SpendSession> {
    const raw = await this.redis.safeGet(`spend_session:${sessionId}`);
    if (!raw) {
      throw new AppError('SPEND_SESSION_EXPIRED');
    }
    return JSON.parse(raw) as SpendSession;
  }

  /** Submitting an amount consumes the session — one lookup, one spend. */
  async consume(sessionId: string): Promise<void> {
    await this.redis.safeDel(`spend_session:${sessionId}`);
  }
}

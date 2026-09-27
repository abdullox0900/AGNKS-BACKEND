import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AddressInfo } from 'node:net';

import { BotController } from '@/modules/bot/bot.controller';
import { CLIENT_BOT, STAFF_BOT } from '@/infra/telegram/telegram.constants';
import { RedisService } from '@/infra/redis/redis.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { TimeoutInterceptor } from '@/common/interceptors/timeout.interceptor';
import { IdempotencyInterceptor } from '@/common/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { validateEnv } from '@/config/env.validation';

/**
 * Boots the real BotController behind the same global guard/filter/interceptors
 * as AppModule. Postgres/Redis are stubbed (the idempotency store is only
 * touched after the header check) and the bot gets a preset botInfo so grammY
 * never calls the Telegram API.
 */

const SECRET = 'test-webhook-secret_123';
const THROTTLE_LIMIT = 3;

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown) {
    return body;
  }
}

const botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

describe('Telegram webhook (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ TELEGRAM_WEBHOOK_SECRET: SECRET })] }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: THROTTLE_LIMIT }]),
      ],
      controllers: [BotController, EchoController],
      providers: [
        { provide: CLIENT_BOT, useValue: new Bot('123456:TEST', { botInfo }) },
        { provide: STAFF_BOT, useValue: null },
        { provide: RedisService, useValue: { safeGet: async () => null, safeSet: async () => undefined } },
        {
          provide: PrismaService,
          useValue: { idempotencyKey: { findUnique: async () => null, upsert: async () => ({}) } },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(async () => {
    await app.close();
  });

  let updateId = 1;
  const webhook = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/webhook/client-bot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ update_id: updateId++ }),
    });

  it('accepts an update with the right secret and no Idempotency-Key → 200', async () => {
    const res = await webhook({ 'x-telegram-bot-api-secret-token': SECRET });
    expect(res.status).toBe(200);
  });

  it('rejects a missing secret → 401', async () => {
    const res = await webhook();
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret → 401', async () => {
    const res = await webhook({ 'x-telegram-bot-api-secret-token': 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  it('is never rate-limited, even well past the throttle limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < THROTTLE_LIMIT * 4; i++) {
      statuses.push((await webhook({ 'x-telegram-bot-api-secret-token': SECRET })).status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('still requires Idempotency-Key on every other POST → 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('still rate-limits other routes (control for the throttle test)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < THROTTLE_LIMIT + 2; i++) {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': `k-${i}` },
        body: JSON.stringify({ i }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe('env validation', () => {
  it('refuses to boot in production without TELEGRAM_WEBHOOK_SECRET', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() => validateEnv({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: '   ' })).toThrow();
  });

  it('allows an empty secret outside production', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('rejects characters Telegram does not allow in secret_token', () => {
    expect(() => validateEnv({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: 'has space' })).toThrow();
    expect(validateEnv({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: SECRET }).TELEGRAM_WEBHOOK_SECRET).toBe(SECRET);
  });
});

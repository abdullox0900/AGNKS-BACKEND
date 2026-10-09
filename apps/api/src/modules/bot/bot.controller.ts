import { Controller, HttpCode, Inject, Logger, Optional, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { webhookCallback, type Bot } from 'grammy';
import { CLIENT_BOT, CLIENT_BOTS, STAFF_BOT } from '@/infra/telegram/telegram.constants';
import { MAIN_BOT_KEY, type ClientBotRegistry } from '@/infra/telegram/client-bots';
import { SkipIdempotency } from '@/common/decorators/skip-idempotency.decorator';

type ExpressWebhookHandler = (req: Request, res: Response) => Promise<unknown>;

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Telegram webhooks. Telegram can't send Idempotency-Key (it dedups by
 * update_id itself) and delivers from several shared IPs, so both the global
 * idempotency requirement and the per-IP rate limit are skipped here. Instead
 * every request must carry the secret_token we registered with setWebhook.
 */
@Controller('webhook')
@SkipIdempotency()
@SkipThrottle()
export class BotController {
  private readonly logger = new Logger(BotController.name);
  private readonly clientHandler: ExpressWebhookHandler | null;
  private readonly staffHandler: ExpressWebhookHandler | null;
  /** per-station client bots, by key */
  private readonly stationHandlers = new Map<string, ExpressWebhookHandler>();
  private readonly secretDigest: Buffer | null;

  constructor(
    @Inject(CLIENT_BOT) clientBot: Bot | null,
    @Inject(STAFF_BOT) staffBot: Bot | null,
    config: ConfigService,
    @Optional() @Inject(CLIENT_BOTS) registry?: ClientBotRegistry,
  ) {
    this.clientHandler = clientBot ? (webhookCallback(clientBot, 'express') as ExpressWebhookHandler) : null;
    for (const entry of registry?.all() ?? []) {
      if (entry.key !== MAIN_BOT_KEY) this.stationHandlers.set(entry.key, webhookCallback(entry.bot, 'express') as ExpressWebhookHandler);
    }
    this.staffHandler = staffBot ? (webhookCallback(staffBot, 'express') as ExpressWebhookHandler) : null;

    // Required in production (see env.validation.ts); outside production an
    // empty value leaves the webhook open for local testing.
    const secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET', '');
    this.secretDigest = secret ? digest(secret) : null;
    if (!secret) this.logger.warn('TELEGRAM_WEBHOOK_SECRET is empty — webhook secret check disabled (dev only)');
  }

  // Nest defaults POST to 201 and grammY's adapter doesn't set a status itself.
  @Post('client-bot')
  @HttpCode(200)
  client(@Req() req: Request, @Res() res: Response) {
    return this.handle('client-bot', this.clientHandler, req, res);
  }

  /** One webhook per station bot: /webhook/client-bot/<key> (the original bot stays on /webhook/client-bot). */
  @Post('client-bot/:key')
  @HttpCode(200)
  clientStation(@Param('key') key: string, @Req() req: Request, @Res() res: Response) {
    if (key === MAIN_BOT_KEY) return this.handle('client-bot', this.clientHandler, req, res);
    return this.handle(`client-bot:${key}`, this.stationHandlers.get(key) ?? null, req, res);
  }

  @Post('staff-bot')
  @HttpCode(200)
  staff(@Req() req: Request, @Res() res: Response) {
    return this.handle('staff-bot', this.staffHandler, req, res);
  }

  private async handle(name: string, handler: ExpressWebhookHandler | null, req: Request, res: Response) {
    if (!this.isAuthorized(req)) {
      this.logger.warn(`${name} webhook rejected: bad or missing secret token (ip ${req.ip})`);
      return res.sendStatus(401);
    }
    if (!handler) return res.sendStatus(503);

    // Any failure while processing an update is logged but still answered with
    // 200 — otherwise Telegram keeps redelivering the same update forever.
    // (Handler errors inside the bot are already caught by bot.catch(); this is
    // the outer net for the webhook transport itself, e.g. its timeout.)
    try {
      await handler(req, res);
    } catch (err) {
      this.logger.error(`${name} webhook error: ${(err as Error).message}`, (err as Error).stack);
    }
    if (!res.headersSent) res.sendStatus(200);
  }

  private isAuthorized(req: Request): boolean {
    if (!this.secretDigest) return true;
    const provided = req.header(SECRET_HEADER);
    if (!provided) return false;
    // Hash both sides so timingSafeEqual always compares equal-length buffers.
    return timingSafeEqual(digest(provided), this.secretDigest);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

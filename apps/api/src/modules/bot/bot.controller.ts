import { All, Controller, Inject, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { webhookCallback, type Bot } from 'grammy';
import { CLIENT_BOT, STAFF_BOT } from '@/infra/telegram/telegram.constants';

type ExpressWebhookHandler = (req: Request, res: Response) => Promise<unknown>;

@Controller('webhook')
export class BotController {
  private readonly logger = new Logger(BotController.name);
  private readonly clientHandler: ExpressWebhookHandler | null;
  private readonly staffHandler: ExpressWebhookHandler | null;

  constructor(
    @Inject(CLIENT_BOT) clientBot: Bot | null,
    @Inject(STAFF_BOT) staffBot: Bot | null,
  ) {
    this.clientHandler = clientBot ? (webhookCallback(clientBot, 'express') as ExpressWebhookHandler) : null;
    this.staffHandler = staffBot ? (webhookCallback(staffBot, 'express') as ExpressWebhookHandler) : null;
  }

  @All('client-bot')
  async client(@Req() req: Request, @Res() res: Response) {
    if (!this.clientHandler) return res.sendStatus(503);
    // A single bad update must never crash the process (TZ-4 §11) — the bot
    // itself already wraps handlers in bot.catch(); this is the outer net
    // for anything in the webhook transport layer around it.
    try {
      await this.clientHandler(req, res);
    } catch (err) {
      this.logger.error(`client-bot webhook error: ${(err as Error).message}`);
      if (!res.headersSent) res.sendStatus(200);
    }
  }

  @All('staff-bot')
  async staff(@Req() req: Request, @Res() res: Response) {
    if (!this.staffHandler) return res.sendStatus(503);
    try {
      await this.staffHandler(req, res);
    } catch (err) {
      this.logger.error(`staff-bot webhook error: ${(err as Error).message}`);
      if (!res.headersSent) res.sendStatus(200);
    }
  }
}

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { CLIENT_BOT, STAFF_BOT } from './telegram.constants';
import { TelegramInitDataService } from './init-data.service';

const logger = new Logger('TelegramModule');

function createBot(token: string | undefined, name: string): Bot | null {
  if (!token) {
    logger.warn(`${name} token not configured — bot disabled`);
    return null;
  }
  const bot = new Bot(token);
  // A single handler throwing must never crash the process — grammY routes
  // every update error here instead of letting it bubble to an unhandled rejection.
  bot.catch((err) => {
    logger.error(`${name} handler error: ${err.message}`, err.stack);
  });
  return bot;
}

@Global()
@Module({
  providers: [
    {
      provide: CLIENT_BOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createBot(config.get('TELEGRAM_CLIENT_BOT_TOKEN'), 'client-bot'),
    },
    {
      provide: STAFF_BOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createBot(config.get('TELEGRAM_STAFF_BOT_TOKEN'), 'staff-bot'),
    },
    TelegramInitDataService,
  ],
  exports: [CLIENT_BOT, STAFF_BOT, TelegramInitDataService],
})
export class TelegramModule {}

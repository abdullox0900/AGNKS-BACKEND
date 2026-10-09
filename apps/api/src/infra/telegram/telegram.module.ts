import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { CLIENT_BOT, CLIENT_BOTS, STAFF_BOT } from './telegram.constants';
import { ClientBotRegistry, clientBotTokens, MAIN_BOT_KEY } from './client-bots';
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
      provide: CLIENT_BOTS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const tokens = clientBotTokens(config.get('TELEGRAM_CLIENT_BOT_TOKEN'), config.get('TELEGRAM_EXTRA_BOT_TOKENS'));
        if (tokens.length === 0) logger.warn('no client bot token configured — client bots disabled');
        const entries = tokens.flatMap((t) => {
          const bot = createBot(t.token, t.key === MAIN_BOT_KEY ? 'client-bot' : `client-bot:${t.key}`);
          return bot ? [{ ...t, bot }] : [];
        });
        logger.log(`client bots: ${entries.map((e) => e.key).join(', ') || 'none'}`);
        return new ClientBotRegistry(entries);
      },
    },
    {
      // the original bot, kept as its own token for code that only needs "the" client bot
      provide: CLIENT_BOT,
      inject: [CLIENT_BOTS],
      useFactory: (registry: ClientBotRegistry) => registry.get(MAIN_BOT_KEY)?.bot ?? null,
    },
    {
      provide: STAFF_BOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createBot(config.get('TELEGRAM_STAFF_BOT_TOKEN'), 'staff-bot'),
    },
    TelegramInitDataService,
  ],
  exports: [CLIENT_BOT, CLIENT_BOTS, STAFF_BOT, TelegramInitDataService],
})
export class TelegramModule {}

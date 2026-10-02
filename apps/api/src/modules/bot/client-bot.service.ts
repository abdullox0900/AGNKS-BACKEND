import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Bot } from 'grammy';
import { CLIENT_BOT } from '@/infra/telegram/telegram.constants';
import { UsersService } from '@/modules/users/users.service';

/**
 * The bot is the only trusted source for a client's phone number (TZ-4 §7.1)
 * — the WebApp's own `requestContact()` result is never written directly.
 *
 * Registration (name, then phone) happens entirely here so that by the time
 * the client opens the Mini App it's already fully registered — no separate
 * in-app onboarding step. State for the two-step conversation is kept
 * in-memory (keyed by Telegram user id): if the process restarts mid-flow the
 * client just runs /start again, which is an acceptable cost for a flow this
 * short.
 */
@Injectable()
export class ClientBotService implements OnModuleInit {
  private readonly logger = new Logger(ClientBotService.name);
  private readonly awaitingName = new Set<number>();
  private readonly pendingName = new Map<number, string>();

  constructor(
    @Inject(CLIENT_BOT) private readonly bot: Bot | null,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    if (!this.bot) return;

    this.bot.command('start', async (ctx) => {
      if (!ctx.from) return;

      // Already registered: just point to the app. Re-registering would be pointless (and the account,
      // card and bonuses are keyed by the Telegram id anyway, so nothing is lost either way).
      const existing = await this.users.findRegisteredByTg(ctx.from.id);
      if (existing) {
        this.awaitingName.delete(ctx.from.id);
        this.pendingName.delete(ctx.from.id);
        await ctx.reply(
          existing.lang === 'ru'
            ? `Здравствуйте, ${existing.firstName}! Вы уже зарегистрированы. Откройте приложение кнопкой внизу.`
            : `Assalomu alaykum, ${existing.firstName}! Siz allaqachon ro'yxatdan o'tgansiz. Ilovani pastdagi tugma orqali oching.`,
          { reply_markup: { remove_keyboard: true } },
        );
        return;
      }

      this.awaitingName.add(ctx.from.id);
      this.pendingName.delete(ctx.from.id);
      await ctx.reply("Assalomu alaykum! Ro'yxatdan o'tish uchun ismingizni yozing.", {
        reply_markup: { remove_keyboard: true },
      });
    });

    this.bot.on('message:text', async (ctx) => {
      if (!ctx.from || !this.awaitingName.has(ctx.from.id)) return;

      const firstName = ctx.message.text.trim().slice(0, 40);
      if (firstName.length < 2) {
        await ctx.reply("Ism juda qisqa — to'liq ismingizni yozing.");
        return;
      }

      this.pendingName.set(ctx.from.id, firstName);
      this.awaitingName.delete(ctx.from.id);
      await ctx.reply('Rahmat! Endi telefon raqamingizni ulashing.', {
        reply_markup: {
          keyboard: [[{ text: 'Raqamni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    });

    this.bot.on('message:contact', async (ctx) => {
      const contact = ctx.message.contact;
      if (!ctx.from || contact.user_id !== ctx.from.id) {
        // Never accept a contact card forwarded from someone else's chat.
        await ctx.reply("Iltimos, o'zingizning raqamingizni ulashing.");
        return;
      }

      const firstName = this.pendingName.get(ctx.from.id) ?? ctx.from.first_name ?? 'Mijoz';
      await this.users.registerFromBot(ctx.from.id, firstName, contact.phone_number);
      this.pendingName.delete(ctx.from.id);

      await ctx.reply("Ro'yxatdan o'tish yakunlandi! Ilovani pastdagi tugma orqali oching.", {
        reply_markup: { remove_keyboard: true },
      });
    });

    this.logger.log('Client bot handlers registered');
  }
}

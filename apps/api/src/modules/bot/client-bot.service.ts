import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { Bot } from 'grammy';
import { CLIENT_BOT, CLIENT_BOTS } from '@/infra/telegram/telegram.constants';
import { MAIN_BOT_KEY, type ClientBotRegistry } from '@/infra/telegram/client-bots';
import { UsersService } from '@/modules/users/users.service';

type Lang = 'uz' | 'ru';

/** Bot copy, in the language of the person's Telegram client (or their saved language once registered). */
const TEXT = {
  uz: {
    welcome: (name: string) =>
      `Assalomu alaykum${name ? `, ${name}` : ''}! 👋\n\n` +
      `AGNKS bonus botiga xush kelibsiz. Bu yerda metan quyganingiz uchun bonus yig'asiz:\n\n` +
      `⛽ Quyganingizdan keyin chekdagi QR kodni ilovada skanerlang — summa soliq.uz dan olinadi va bonus hisobingizga avtomatik tushadi.\n` +
      `🎁 To'plangan bonusni keyingi safar kassada to'lov sifatida ishlatasiz.\n` +
      `🔥 Aksiyalar va yangi narxlardan birinchi bo'lib xabardor bo'lasiz.\n` +
      `📋 Barcha cheklaringiz va bonuslar tarixi ilovada saqlanadi.\n\n` +
      `Boshlash uchun ismingizni yozing.`,
    askName: "Ro'yxatdan o'tish uchun ismingizni yozing.",
    shortName: "Ism juda qisqa — to'liq ismingizni yozing.",
    askPhone: 'Rahmat! Endi telefon raqamingizni ulashing.',
    sharePhone: 'Raqamni ulashish',
    ownPhoneOnly: "Iltimos, o'zingizning raqamingizni ulashing.",
    done: "Ro'yxatdan o'tish yakunlandi! 🎉 Ilovani pastdagi tugma orqali oching: chek skanerlang va bonus yig'ing.",
    already: (name: string) => `Assalomu alaykum, ${name}! Siz allaqachon ro'yxatdan o'tgansiz. Ilovani pastdagi tugma orqali oching.`,
    alreadyShort: "Siz allaqachon ro'yxatdan o'tgansiz. Ilovani pastdagi tugma orqali oching.",
    phoneTaken:
      "Bu raqam boshqa Telegram akkauntida ro'yxatdan o'tgan. Agar raqam sizniki bo'lsa, shoxobcha ma'muriyatiga murojaat qiling.",
    conflict: "Hisobingizni avtomatik ulab bo'lmadi. Iltimos, shoxobcha ma'muriyatiga murojaat qiling.",
    error: "Xatolik yuz berdi. Iltimos, birozdan so'ng /start ni qayta yuboring.",
  },
  ru: {
    welcome: (name: string) =>
      `Здравствуйте${name ? `, ${name}` : ''}! 👋\n\n` +
      `Добро пожаловать в бонусный бот AGNKS. Здесь вы копите бонусы за заправку метаном:\n\n` +
      `⛽ После заправки отсканируйте QR-код с чека в приложении — сумма берётся из soliq.uz, бонусы зачисляются автоматически.\n` +
      `🎁 Накопленными бонусами можно оплатить следующую заправку на кассе.\n` +
      `🔥 Вы первыми узнаете об акциях и новых ценах.\n` +
      `📋 История всех чеков и бонусов хранится в приложении.\n\n` +
      `Чтобы начать, напишите своё имя.`,
    askName: 'Для регистрации напишите своё имя.',
    shortName: 'Слишком короткое имя — напишите полное имя.',
    askPhone: 'Спасибо! Теперь поделитесь номером телефона.',
    sharePhone: 'Поделиться номером',
    ownPhoneOnly: 'Пожалуйста, поделитесь своим номером.',
    done: 'Регистрация завершена! 🎉 Откройте приложение кнопкой внизу: сканируйте чеки и копите бонусы.',
    already: (name: string) => `Здравствуйте, ${name}! Вы уже зарегистрированы. Откройте приложение кнопкой внизу.`,
    alreadyShort: 'Вы уже зарегистрированы. Откройте приложение кнопкой внизу.',
    phoneTaken: 'Этот номер уже зарегистрирован в другом аккаунте Telegram. Если номер ваш, обратитесь к администрации АЗС.',
    conflict: 'Не удалось автоматически привязать аккаунт. Пожалуйста, обратитесь к администрации АЗС.',
    error: 'Произошла ошибка. Пожалуйста, чуть позже отправьте /start снова.',
  },
} as const;

const tgLang = (code?: string): Lang => (code?.toLowerCase().startsWith('ru') ? 'ru' : 'uz');

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
  // Conversation state is per bot: the same person may be in the middle of the flow in two bots at once.
  private readonly awaitingName = new Set<string>();
  private readonly pendingName = new Map<string, string>();

  constructor(
    @Inject(CLIENT_BOT) private readonly bot: Bot | null,
    private readonly users: UsersService,
    @Optional() @Inject(CLIENT_BOTS) private readonly registry?: ClientBotRegistry,
  ) {}

  onModuleInit(): void {
    // Every client bot — the original one and the per-station ones — gets the same behaviour.
    const bots = this.registry ? this.registry.all().map((e) => ({ key: e.key, bot: e.bot as Bot })) : this.bot ? [{ key: MAIN_BOT_KEY, bot: this.bot }] : [];
    for (const { key, bot } of bots) this.register(bot, key);
    if (bots.length) this.logger.log(`Client bot handlers registered (${bots.map((b) => b.key).join(', ')})`);
  }

  private register(bot: Bot, botKey: string): void {
    const state = (id: number) => `${botKey}:${id}`;

    bot.command('start', async (ctx) => {
      if (!ctx.from) return;
      const lang = tgLang(ctx.from.language_code);
      await this.users.setBotKey(ctx.from.id, botKey).catch(() => undefined);

      // Already registered: just point to the app. Re-registering would be pointless (and the account,
      // card and bonuses are keyed by the Telegram id anyway, so nothing is lost either way).
      const existing = await this.users.findRegisteredByTg(ctx.from.id);
      if (existing) {
        this.awaitingName.delete(state(ctx.from.id));
        this.pendingName.delete(state(ctx.from.id));
        await ctx.reply(TEXT[existing.lang].already(existing.firstName), { reply_markup: { remove_keyboard: true } });
        return;
      }

      this.awaitingName.add(state(ctx.from.id));
      this.pendingName.delete(state(ctx.from.id));
      await ctx.reply(TEXT[lang].welcome(ctx.from.first_name?.slice(0, 40) ?? ''), { reply_markup: { remove_keyboard: true } });
    });

    bot.on('message:text', async (ctx) => {
      if (!ctx.from || !this.awaitingName.has(state(ctx.from.id))) return;
      const t = TEXT[tgLang(ctx.from.language_code)];

      const firstName = ctx.message.text.trim().slice(0, 40);
      if (firstName.length < 2) {
        await ctx.reply(t.shortName);
        return;
      }

      this.pendingName.set(state(ctx.from.id), firstName);
      this.awaitingName.delete(state(ctx.from.id));
      await ctx.reply(t.askPhone, {
        reply_markup: {
          keyboard: [[{ text: t.sharePhone, request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    });

    bot.on('message:contact', async (ctx) => {
      const lang = tgLang(ctx.from?.language_code);
      const t = TEXT[lang];
      const contact = ctx.message.contact;
      if (!ctx.from || contact.user_id !== ctx.from.id) {
        // Never accept a contact card forwarded from someone else's chat.
        await ctx.reply(t.ownPhoneOnly);
        return;
      }

      const firstName = this.pendingName.get(state(ctx.from.id)) ?? ctx.from.first_name ?? 'Mijoz';
      const result = await this.users.registerFromBot(ctx.from.id, firstName, contact.phone_number, lang);
      this.pendingName.delete(state(ctx.from.id));
      if (result === 'registered' || result === 'already') await this.users.setBotKey(ctx.from.id, botKey).catch(() => undefined);

      const remove = { reply_markup: { remove_keyboard: true as const } };
      if (result === 'registered') await ctx.reply(t.done, remove);
      else if (result === 'already') await ctx.reply(t.alreadyShort, remove);
      else if (result === 'phone_taken') await ctx.reply(t.phoneTaken, remove);
      else await ctx.reply(t.conflict, remove);
    });

    // A failing handler must never leave the person with a silent bot.
    bot.catch(async (err) => {
      this.logger.error(`client bot ${botKey} update ${err.ctx.update.update_id} failed: ${err.message}`, err.error instanceof Error ? err.error.stack : undefined);
      const lang = tgLang(err.ctx.from?.language_code);
      await err.ctx.reply(TEXT[lang].error, { reply_markup: { remove_keyboard: true } }).catch(() => undefined);
    });
  }
}

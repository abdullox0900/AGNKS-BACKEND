import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Bot } from 'grammy';
import { STAFF_BOT } from '@/infra/telegram/telegram.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';

@Injectable()
export class StaffBotService implements OnModuleInit {
  private readonly logger = new Logger(StaffBotService.name);

  constructor(
    @Inject(STAFF_BOT) private readonly bot: Bot | null,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.bot) return;

    this.bot.command('start', async (ctx) => {
      await ctx.reply('Xodim sifatida bog\'lanish uchun raqamingizni ulashing.', {
        reply_markup: {
          keyboard: [[{ text: 'Raqamni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    });

    this.bot.on('message:contact', async (ctx) => {
      const contact = ctx.message.contact;
      if (contact.user_id !== ctx.from?.id) {
        await ctx.reply("Iltimos, o'zingizning raqamingizni ulashing.");
        return;
      }

      const phone = normalizePhone(contact.phone_number);
      const user = await this.prisma.user.findUnique({ where: { phone }, include: { roles: true } });
      if (!user || user.roles.length === 0) {
        await ctx.reply('Siz xodimlar ro\'yxatida yo\'qsiz. Filial rahbariga murojaat qiling.', {
          reply_markup: { remove_keyboard: true },
        });
        return;
      }

      await this.prisma.user.update({ where: { id: user.id }, data: { tgUserId: BigInt(ctx.from.id) } });
      await ctx.reply("Bog'landi. Botdagi ilova tugmasidan WebApp'ni oching.", { reply_markup: { remove_keyboard: true } });
    });

    this.logger.log('Staff bot handlers registered');
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.startsWith('998') ? `+${digits}` : `+998${digits.slice(-9)}`;
}

import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError, pinLoginSchema, type PinLoginDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import type { StaffActor } from '@/common/types/actor';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { TelegramInitDataService } from '@/infra/telegram/init-data.service';
import { PinAuthService } from './pin-auth.service';
import { TokenService } from './token.service';

const refreshSchema = z.object({ refreshToken: z.string() });
const linkSchema = z.object({ initData: z.string().min(10) });

@Controller('cashier/auth')
export class CashierAuthController {
  constructor(
    private readonly pinAuth: PinAuthService,
    private readonly tokens: TokenService,
    private readonly initData: TelegramInitDataService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(pinLoginSchema)) dto: PinLoginDto) {
    return this.pinAuth.login(dto.phone, dto.pin);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: { refreshToken: string }) {
    const payload = this.tokens.verifyRefresh(dto.refreshToken);
    const base = { sub: payload.sub, role: payload.role, stationId: payload.stationId, terminalIds: payload.terminalIds };
    return {
      accessToken: this.tokens.signAccess(base, '15m'),
      refreshToken: this.tokens.signRefresh(base, '12h'),
    };
  }

  /**
   * Called by the cashier webapp when it is opened inside Telegram, after the phone + password login: remembers
   * which Telegram chat belongs to this cashier so the evening summary can reach them. It never logs anyone in.
   */
  @Post('telegram-link')
  @UseGuards(StaffAuthGuard)
  @HttpCode(200)
  async linkTelegram(@Body(new ZodValidationPipe(linkSchema)) dto: { initData: string }, @CurrentStaff() actor: StaffActor) {
    if (actor.role !== 'cashier') throw new AppError('AUTH_FORBIDDEN');
    const parsed = this.initData.validate(dto.initData, 'staff');
    const tg = BigInt(parsed.user.id);

    const owner = await this.prisma.user.findUnique({ where: { tgUserId: tg }, select: { id: true } });
    if (owner && owner.id !== actor.userId) {
      // the same Telegram account already belongs to another user row (e.g. registered as a client under a
      // different phone number) — a Telegram id can only be stored once, so this cashier gets no DM
      return { linked: false, reason: 'telegram_in_use' };
    }
    if (!owner) await this.prisma.user.update({ where: { id: actor.userId }, data: { tgUserId: tg } });
    return { linked: true };
  }
}

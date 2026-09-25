import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { TelegramInitDataService } from '@/infra/telegram/init-data.service';
import type { ClientActor } from '@/common/types/actor';

@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(
    private readonly initData: TelegramInitDataService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization') ?? '';

    if (!header.startsWith('tma ')) {
      throw new AppError('AUTH_INVALID_INIT_DATA');
    }

    const parsed = this.initData.validate(header.slice(4), 'client');

    // Any verified Telegram user opening the Mini App is lazily provisioned —
    // "not registered" is an onboarding state (no phone/consent yet), not an
    // auth failure. Individual endpoints that require a completed profile
    // enforce that themselves via RequireRegisteredGuard.
    const user = await this.findOrCreateUser(parsed.user.id, parsed.user.first_name ?? '');

    if (user.status !== 'active') {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'user_blocked' });
    }
    if (user.card!.blocked) {
      throw new AppError('CARD_BLOCKED');
    }

    const actor: ClientActor = {
      kind: 'client',
      userId: user.id,
      cardId: user.card!.id,
      tgUserId: parsed.user.id,
    };
    request.actor = actor;
    return true;
  }

  private async findOrCreateUser(tgUserId: number, firstName: string) {
    const existing = await this.prisma.user.findUnique({
      where: { tgUserId: BigInt(tgUserId) },
      include: { card: true },
    });
    if (existing) return existing;

    try {
      return await this.prisma.user.create({
        data: {
          tgUserId: BigInt(tgUserId),
          firstName,
          card: { create: { number: generateCardNumber() } },
        },
        include: { card: true },
      });
    } catch {
      // Lost a create race against a concurrent request for the same tg user — read the winner.
      const winner = await this.prisma.user.findUnique({
        where: { tgUserId: BigInt(tgUserId) },
        include: { card: true },
      });
      if (!winner) throw new AppError('INTERNAL_ERROR');
      return winner;
    }
  }
}

function generateCardNumber(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  return `AG${digits}`;
}

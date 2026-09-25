import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { TelegramInitDataService } from '@/infra/telegram/init-data.service';
import { TokenService } from '@/modules/auth/token.service';
import type { StaffActor } from '@/common/types/actor';

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly initData: TelegramInitDataService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization') ?? '';

    const actor = header.startsWith('tma ')
      ? await this.viaTelegram(header.slice(4))
      : header.startsWith('Bearer ')
        ? this.viaJwt(header.slice(7))
        : null;

    if (!actor) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'missing_credentials' });
    }

    request.actor = actor;
    return true;
  }

  private async viaTelegram(initData: string): Promise<StaffActor> {
    const parsed = this.initData.validate(initData, 'staff');

    const user = await this.prisma.user.findUnique({
      where: { tgUserId: BigInt(parsed.user.id) },
      include: { roles: true },
    });

    const staffRole = user?.roles.find((r) => r.role !== undefined);
    if (!user || user.status !== 'active' || !staffRole) {
      throw new AppError('AUTH_STAFF_NOT_FOUND');
    }

    return {
      kind: 'staff',
      userId: user.id,
      role: staffRole.role,
      stationId: staffRole.stationId,
      terminalIds: staffRole.terminalIds,
    };
  }

  private viaJwt(token: string): StaffActor {
    const payload = this.tokens.verifyAccess(token);
    return {
      kind: 'staff',
      userId: payload.sub,
      role: payload.role,
      stationId: payload.stationId,
      terminalIds: payload.terminalIds,
    };
  }
}

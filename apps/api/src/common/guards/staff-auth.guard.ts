import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@agnks/types';
import { TokenService } from '@/modules/auth/token.service';
import type { StaffActor } from '@/common/types/actor';

/**
 * Staff sign in with phone + password in the webapp and call the API with that JWT. Telegram is not a login
 * method for staff (initData is only used to remember the cashier's chat for the daily summary).
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization') ?? '';

    if (!header.startsWith('Bearer ')) {
      throw new AppError('AUTH_TOKEN_INVALID', { reason: 'missing_credentials' });
    }

    const payload = this.tokens.verifyAccess(header.slice(7));
    const actor: StaffActor = {
      kind: 'staff',
      userId: payload.sub,
      role: payload.role,
      stationId: payload.stationId,
      terminalIds: payload.terminalIds,
    };
    request.actor = actor;
    return true;
  }
}

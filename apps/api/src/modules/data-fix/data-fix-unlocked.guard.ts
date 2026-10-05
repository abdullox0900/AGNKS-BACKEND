import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@agnks/types';
import { DataFixGateService } from './data-fix-gate.service';

/** The data-correction endpoints only work with a fresh token from the page password (header X-DataFix-Token). */
@Injectable()
export class DataFixUnlockedGuard implements CanActivate {
  constructor(private readonly gate: DataFixGateService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const actor = req.actor;
    const token = req.header('x-datafix-token');
    if (!actor || actor.kind !== 'staff' || !this.gate.verify(token, actor.userId)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'datafix_locked' });
    }
    return true;
  }
}

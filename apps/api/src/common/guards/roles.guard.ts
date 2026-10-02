import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError, type StaffRole } from '@agnks/types';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.actor;

    // root_admin is a view-only role by product decision: it may read every dashboard endpoint it is
    // allowed to see, but never change anything. One rule here covers every create/update/delete route.
    // (/admin/auth/* — login, refresh, own password — does not go through this guard.)
    if (actor?.kind === 'staff' && actor.role === 'root_admin' && !SAFE_METHODS.has(request.method)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'read_only_role' });
    }

    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (!actor || actor.kind !== 'staff' || !required.includes(actor.role)) {
      throw new AppError('AUTH_FORBIDDEN');
    }
    return true;
  }
}

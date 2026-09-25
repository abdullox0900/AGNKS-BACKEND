import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError, isNetworkWideRole } from '@agnks/types';

/**
 * Query-level guard: a branch_manager may only ask for data scoped to their
 * own station. Resource-level checks (e.g. "does this shift belong to my
 * station") still happen in the relevant service via `assertStationAccess`.
 */
@Injectable()
export class StationScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.actor;
    if (!actor || actor.kind !== 'staff') {
      throw new AppError('AUTH_FORBIDDEN');
    }
    if (isNetworkWideRole(actor.role)) return true;

    const requested = extractStationIds(request);
    if (requested.length === 0) return true;

    const allowed = requested.every((id) => id === actor.stationId);
    if (!allowed) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
    }
    return true;
  }
}

function extractStationIds(request: Request): string[] {
  const query = request.query;
  const raw = query.stationId ?? query.stationIds;
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(String);
}

export function assertStationAccess(
  actor: { role: string; stationId: string | null },
  resourceStationId: string,
): void {
  if (isNetworkWideRole(actor.role as never)) return;
  if (actor.stationId !== resourceStationId) {
    throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
  }
}

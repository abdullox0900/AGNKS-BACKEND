import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppError, isNetworkWideRole, type CreateStaffDto, type StaffRole, type UpdateStaffDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { PinAuthService } from '@/modules/auth/pin-auth.service';
import { DashboardAuthService } from '@/modules/auth/dashboard-auth.service';
import type { StaffActor } from '@/common/types/actor';

const DASHBOARD_ROLES: StaffRole[] = ['branch_manager', 'root_admin', 'seo'];

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pinAuth: PinAuthService,
    private readonly dashboardAuth: DashboardAuthService,
  ) {}

  async list(actor: StaffActor, role?: StaffRole, stationId?: string) {
    const scoped = isNetworkWideRole(actor.role) ? stationId : actor.stationId;
    return this.prisma.userRole.findMany({
      where: { role, stationId: scoped ?? undefined },
      include: { user: true, station: true },
      orderBy: { user: { firstName: 'asc' } },
    });
  }

  async create(dto: CreateStaffDto, actor: StaffActor) {
    if (!isNetworkWideRole(actor.role) && dto.stationId !== actor.stationId) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
    }
    // Only root_admin/seo may create OTHER dashboard accounts — a branch_manager can still
    // create cashiers for their own station, but not other managers/admins.
    if (DASHBOARD_ROLES.includes(dto.role) && !isNetworkWideRole(actor.role)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'dashboard_role_requires_network_wide' });
    }
    if (DASHBOARD_ROLES.includes(dto.role) && !dto.password) {
      throw new AppError('VALIDATION_ERROR', { message: 'password is required for dashboard roles' });
    }

    const user = await this.prisma.user.upsert({
      where: { phone: dto.phone },
      create: { phone: dto.phone, firstName: dto.firstName },
      update: { firstName: dto.firstName },
    });

    const role = await this.prisma.userRole.create({
      data: {
        userId: user.id,
        role: dto.role,
        stationId: dto.stationId ?? null,
        terminalIds: dto.terminalIds ?? [],
      },
    });

    let generatedPin: string | undefined;
    let recoveryCode: string | undefined;
    if (dto.role === 'cashier') {
      generatedPin = dto.pin ?? generatePin();
      await this.pinAuth.setPin(user.id, generatedPin);
    } else {
      recoveryCode = (await this.dashboardAuth.setPassword(user.id, dto.password!)).recoveryCode;
    }

    await this.audit.record({
      actorId: actor.userId,
      action: 'staff.create',
      entityType: 'user_role',
      entityId: role.id,
      after: { user, role },
    });

    return { user, role, generatedPin, recoveryCode };
  }

  async update(id: string, dto: UpdateStaffDto, actor: StaffActor) {
    const before = await this.prisma.userRole.findUnique({ where: { id }, include: { user: true } });
    if (!before) throw new AppError('NOT_FOUND');
    if (!isNetworkWideRole(actor.role) && before.stationId !== actor.stationId) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
    }
    // Editing another dashboard account (branch_manager/root_admin/seo) is SEO-only —
    // a branch_manager may still edit their own station's cashiers above.
    if (DASHBOARD_ROLES.includes(before.role) && actor.role !== 'seo') {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'dashboard_edit_requires_seo' });
    }

    const [role] = await this.prisma.$transaction([
      this.prisma.userRole.update({
        where: { id },
        data: { stationId: dto.stationId, terminalIds: dto.terminalIds },
      }),
      ...(dto.firstName
        ? [this.prisma.user.update({ where: { id: before.userId }, data: { firstName: dto.firstName } })]
        : []),
    ]);

    await this.audit.record({ actorId: actor.userId, action: 'staff.update', entityType: 'user_role', entityId: id, before, after: role });
    return role;
  }

  /** `customPin` lets SEO/root_admin/branch_manager set a PIN the cashier will actually
   * remember (their birth year, etc.) instead of always forcing a random one — the
   * random generator is still the default when they just want a quick reset. */
  async resetPin(id: string, actor: StaffActor, customPin?: string): Promise<{ pin: string }> {
    const role = await this.prisma.userRole.findUnique({ where: { id } });
    if (!role || role.role !== 'cashier') throw new AppError('NOT_FOUND');
    if (!isNetworkWideRole(actor.role) && role.stationId !== actor.stationId) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
    }
    if (customPin && !/^\d{4,6}$/.test(customPin)) {
      throw new AppError('VALIDATION_ERROR', { message: 'pin must be 4-6 digits' });
    }

    const pin = customPin ?? generatePin();
    await this.pinAuth.setPin(role.userId, pin);
    await this.audit.record({ actorId: actor.userId, action: 'staff.reset_pin', entityType: 'user_role', entityId: id });
    return { pin };
  }

  async regenerateRecoveryCode(id: string, actor: StaffActor): Promise<{ recoveryCode: string }> {
    const role = await this.prisma.userRole.findUnique({ where: { id } });
    if (!role || !DASHBOARD_ROLES.includes(role.role)) throw new AppError('NOT_FOUND');
    if (!isNetworkWideRole(actor.role)) throw new AppError('AUTH_FORBIDDEN', { reason: 'dashboard_role_requires_network_wide' });

    const { recoveryCode } = await this.dashboardAuth.regenerateRecoveryCode(role.userId);
    await this.audit.record({ actorId: actor.userId, action: 'staff.regenerate_recovery_code', entityType: 'user_role', entityId: id });
    return { recoveryCode };
  }

  async remove(id: string, actor: StaffActor, password?: string) {
    const role = await this.prisma.userRole.findUnique({ where: { id } });
    if (!role) throw new AppError('NOT_FOUND');
    if (!isNetworkWideRole(actor.role) && role.stationId !== actor.stationId) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'station_out_of_scope' });
    }
    // Deleting another dashboard account is SEO-only, and requires the acting SEO to
    // re-confirm their own password (a step-up check, independent of their session token).
    if (DASHBOARD_ROLES.includes(role.role)) {
      if (actor.role !== 'seo') throw new AppError('AUTH_FORBIDDEN', { reason: 'dashboard_remove_requires_seo' });
      if (!password || !(await this.dashboardAuth.verifyPassword(actor.userId, password))) {
        throw new AppError('AUTH_INVALID_CREDENTIALS');
      }
    }

    await this.prisma.$transaction([
      this.prisma.userRole.delete({ where: { id } }),
      this.prisma.user.update({ where: { id: role.userId }, data: { status: 'blocked' } }),
    ]);

    await this.audit.record({ actorId: actor.userId, action: 'staff.remove', entityType: 'user_role', entityId: id, before: role });
    return { success: true };
  }
}

function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

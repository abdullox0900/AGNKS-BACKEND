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
    // root_admin is view-only and the Admins section is not shown to it: cashiers only.
    if (actor.role === 'root_admin' && role && DASHBOARD_ROLES.includes(role)) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'admins_hidden' });
    }
    const rows = await this.prisma.userRole.findMany({
      where: { role: actor.role === 'root_admin' ? (role ?? 'cashier') : role, stationId: scoped ?? undefined },
      include: { user: true, station: true },
      orderBy: { user: { firstName: 'asc' } },
    });

    // Cashier passwords are visible to whoever manages the cashiers (the list is already scoped to
    // their station); other dashboard accounts' passwords only to SEO (explicit product decisions).
    // root_admin is view-only and gets no credentials at all.
    const visible = rows.filter((r) => (r.role === 'cashier' ? actor.role !== 'root_admin' : DASHBOARD_ROLES.includes(r.role) && actor.role === 'seo'))
    const passwords = visible.length ? await this.dashboardAuth.readPasswords(visible.map((r) => r.userId)) : new Map<string, string>();
    return rows.map((r) => (visible.includes(r) ? { ...r, password: passwords.get(r.userId) ?? null } : r));
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

    // The same person can't get the same role twice (it showed up as a duplicate row in the list).
    const already = await this.prisma.userRole.findFirst({ where: { role: dto.role, user: { phone: dto.phone } }, select: { id: true } });
    if (already) throw new AppError('VALIDATION_ERROR', { message: 'phone_taken' });

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
    if (dto.role === 'cashier') {
      generatedPin = dto.pin ?? generatePin();
      await this.pinAuth.setPin(user.id, generatedPin);
    } else {
      await this.dashboardAuth.setPassword(user.id, dto.password!);
    }

    await this.audit.record({
      actorId: actor.userId,
      action: 'staff.create',
      entityType: 'user_role',
      entityId: role.id,
      after: { user, role },
    });

    return { user, role, generatedPin };
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

    if (dto.phone && dto.phone !== before.user.phone) {
      const taken = await this.prisma.user.findUnique({ where: { phone: dto.phone }, select: { id: true } });
      if (taken && taken.id !== before.userId) throw new AppError('VALIDATION_ERROR', { message: 'phone_taken' });
    }
    if (dto.password && DASHBOARD_ROLES.includes(before.role) && dto.password.length < 6) {
      throw new AppError('VALIDATION_ERROR', { message: 'password_too_short' });
    }

    const [role] = await this.prisma.$transaction([
      this.prisma.userRole.update({
        where: { id },
        data: { stationId: dto.stationId, terminalIds: dto.terminalIds },
      }),
      ...(dto.firstName || dto.phone
        ? [this.prisma.user.update({ where: { id: before.userId }, data: { firstName: dto.firstName, phone: dto.phone } })]
        : []),
    ]);
    if (dto.password) {
      if (DASHBOARD_ROLES.includes(before.role)) await this.dashboardAuth.setPassword(before.userId, dto.password);
      else await this.pinAuth.setPin(before.userId, dto.password);
    }

    await this.audit.record({ actorId: actor.userId, action: 'staff.update', entityType: 'user_role', entityId: id, before, after: { ...role, passwordChanged: !!dto.password } });
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
    if (customPin && (customPin.length < 4 || customPin.length > 72)) {
      throw new AppError('VALIDATION_ERROR', { message: 'password_length' });
    }

    const pin = customPin ?? generatePin();
    await this.pinAuth.setPin(role.userId, pin);
    await this.audit.record({ actorId: actor.userId, action: 'staff.reset_pin', entityType: 'user_role', entityId: id });
    return { pin };
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
      // Nobody removes the account they are logged in with, and the last SEO always stays —
      // otherwise the dashboard could be left with nobody able to manage admins.
      if (role.userId === actor.userId) throw new AppError('AUTH_FORBIDDEN', { reason: 'cannot_remove_self' });
      if (role.role === 'seo') {
        const otherSeo = await this.prisma.userRole.count({ where: { role: 'seo', userId: { not: role.userId } } });
        if (otherSeo === 0) throw new AppError('AUTH_FORBIDDEN', { reason: 'last_seo' });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id } });
      // Only lock the person out when this was their last role (one user can hold several) —
      // and never when the same row is also a registered client, or they'd lose their bonus account too.
      const remaining = await tx.userRole.count({ where: { userId: role.userId } });
      if (remaining === 0) {
        const user = await tx.user.findUnique({ where: { id: role.userId }, select: { registeredAt: true } });
        if (!user?.registeredAt) await tx.user.update({ where: { id: role.userId }, data: { status: 'blocked' } });
      }
    });

    await this.audit.record({ actorId: actor.userId, action: 'staff.remove', entityType: 'user_role', entityId: id, before: role });
    return { success: true };
  }
}

function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

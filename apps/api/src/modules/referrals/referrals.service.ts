import { Injectable } from '@nestjs/common';
import { AppError, isNetworkWideRole, type CreateAttendantDto, type ReferralAnswerDto, type StaffRole, type UpdateAttendantDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { AuditService } from '@/modules/audit/audit.service';

interface Scope {
  role: StaffRole;
  stationId: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * "Kim orqali keldingiz?": the roster of fuel-station attendants, the question new clients are asked,
 * and the ranking of who brought the most clients (for the reward).
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- clients

  /** Stations that have at least one active attendant, with the attendants — what the client picks from. */
  async optionsForClient() {
    const stations = await this.prisma.station.findMany({
      where: { attendants: { some: { active: true } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, attendants: { where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } } },
    });
    return { stations };
  }

  async answer(userId: string, dto: ReferralAnswerDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { registeredAt: true } });
    if (!user?.registeredAt) throw new AppError('NOT_FOUND');
    const existing = await this.prisma.clientReferral.findUnique({ where: { userId } });
    if (existing) return { ok: true }; // answered already — never overwritten, never an error

    if (dto.attendantId) {
      const a = await this.prisma.attendant.findUnique({ where: { id: dto.attendantId }, select: { active: true } });
      if (!a?.active) throw new AppError('VALIDATION_ERROR', { message: 'attendant_unavailable' });
      await this.prisma.clientReferral.create({ data: { userId, attendantId: dto.attendantId } });
    } else if (dto.name) {
      await this.prisma.clientReferral.create({ data: { userId, typedName: dto.name } });
    } else {
      await this.prisma.clientReferral.create({ data: { userId, skipped: true } });
    }
    return { ok: true };
  }

  // -------------------------------------------------------------- attendants

  private stationFilter(scope: Scope, wanted?: string[]) {
    if (isNetworkWideRole(scope.role)) return wanted && wanted.length ? { in: wanted } : undefined;
    return { in: scope.stationId ? [scope.stationId] : [] };
  }

  async listAttendants(scope: Scope, stationIds?: string[]) {
    const rows = await this.prisma.attendant.findMany({
      where: { stationId: this.stationFilter(scope, stationIds) },
      orderBy: [{ station: { name: 'asc' } }, { name: 'asc' }],
      include: { station: { select: { name: true } }, _count: { select: { referrals: true } } },
    });
    return rows.map((a) => ({ id: a.id, name: a.name, active: a.active, stationId: a.stationId, stationName: a.station.name, clients: a._count.referrals }));
  }

  async createAttendant(dto: CreateAttendantDto, actorId: string) {
    const station = await this.prisma.station.findUnique({ where: { id: dto.stationId }, select: { id: true, name: true } });
    if (!station) throw new AppError('NOT_FOUND');
    try {
      const row = await this.prisma.attendant.create({ data: { stationId: dto.stationId, name: dto.name.replace(/\s+/g, ' ') } });
      await this.audit.record({ actorId, action: 'attendant.create', entityType: 'attendant', entityId: row.id, after: { name: row.name, station: station.name } });
      return { id: row.id };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new AppError('VALIDATION_ERROR', { message: 'attendant_exists' });
      throw err;
    }
  }

  async updateAttendant(id: string, dto: UpdateAttendantDto, actorId: string) {
    const before = await this.prisma.attendant.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    try {
      const row = await this.prisma.attendant.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name.replace(/\s+/g, ' ') } : {}), ...(dto.stationId !== undefined ? { stationId: dto.stationId } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}) },
      });
      await this.audit.record({
        actorId,
        action: 'attendant.update',
        entityType: 'attendant',
        entityId: id,
        before: { name: before.name, active: before.active },
        after: { name: row.name, active: row.active },
      });
      return { id };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new AppError('VALIDATION_ERROR', { message: 'attendant_exists' });
      throw err;
    }
  }

  /** Deleting someone who already has clients would erase that credit — they are only switched off instead. */
  async removeAttendant(id: string, actorId: string) {
    const before = await this.prisma.attendant.findUnique({ where: { id }, include: { _count: { select: { referrals: true } } } });
    if (!before) throw new AppError('NOT_FOUND');
    if (before._count.referrals > 0) {
      await this.prisma.attendant.update({ where: { id }, data: { active: false } });
      await this.audit.record({ actorId, action: 'attendant.update', entityType: 'attendant', entityId: id, before: { name: before.name, active: true }, after: { name: before.name, active: false } });
      return { id, deactivated: true };
    }
    await this.prisma.attendant.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'attendant.delete', entityType: 'attendant', entityId: id, before: { name: before.name } });
    return { id, deactivated: false };
  }

  // ----------------------------------------------------------------- ranking

  async getSettings() {
    const [enabled, rewardAmount, enabledFrom] = await Promise.all([
      this.settings.get('referral.enabled'),
      this.settings.get('referral.reward_amount'),
      this.settings.get('referral.enabled_from'),
    ]);
    return { enabled, rewardAmount, enabledFrom: enabledFrom || null };
  }

  async updateSettings(dto: { enabled?: boolean; rewardAmount?: number }, actorId: string) {
    const current = await this.getSettings();
    if (dto.rewardAmount !== undefined) await this.settings.set('referral.reward_amount', dto.rewardAmount, actorId);
    if (dto.enabled !== undefined && dto.enabled !== current.enabled) {
      // remember when it was switched on: only clients who register after that are asked
      if (dto.enabled) await this.settings.set('referral.enabled_from', new Date().toISOString(), actorId);
      await this.settings.set('referral.enabled', dto.enabled, actorId);
    }
    return this.getSettings();
  }

  /**
   * Who brought how many clients in the period. A client who typed a name is counted for the attendant with that
   * exact name when it is unambiguous; every other typed name is listed separately so the SEO can add that person.
   */
  async summary(scope: Scope, from: Date, to: Date, stationIds?: string[]) {
    const stationWhere = this.stationFilter(scope, stationIds);
    const [attendants, referrals, newClients, settings] = await Promise.all([
      this.prisma.attendant.findMany({ where: { stationId: stationWhere }, include: { station: { select: { name: true } } } }),
      this.prisma.clientReferral.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { attendantId: true, typedName: true, skipped: true } }),
      this.prisma.user.count({ where: { registeredAt: { gte: from, lte: to } } }),
      this.getSettings(),
    ]);

    const byId = new Map(attendants.map((a) => [a.id, a]));
    const byName = new Map<string, string[]>();
    for (const a of attendants) byName.set(norm(a.name), [...(byName.get(norm(a.name)) ?? []), a.id]);

    const counts = new Map<string, { direct: number; typed: number }>();
    const unmatched = new Map<string, { name: string; count: number }>();
    let skipped = 0;
    let answered = 0;
    for (const r of referrals) {
      if (r.skipped) {
        skipped++;
        continue;
      }
      if (r.attendantId) {
        if (!byId.has(r.attendantId)) continue; // outside the station scope of this viewer
        answered++;
        const c = counts.get(r.attendantId) ?? { direct: 0, typed: 0 };
        c.direct++;
        counts.set(r.attendantId, c);
      } else if (r.typedName) {
        answered++;
        const matches = byName.get(norm(r.typedName)) ?? [];
        if (matches.length === 1) {
          const c = counts.get(matches[0]) ?? { direct: 0, typed: 0 };
          c.typed++;
          counts.set(matches[0], c);
        } else {
          const key = norm(r.typedName);
          const u = unmatched.get(key) ?? { name: r.typedName.trim(), count: 0 };
          u.count++;
          unmatched.set(key, u);
        }
      }
    }

    const ranking = attendants
      .map((a) => {
        const c = counts.get(a.id) ?? { direct: 0, typed: 0 };
        return { id: a.id, name: a.name, active: a.active, stationId: a.stationId, stationName: a.station.name, clients: c.direct + c.typed, typed: c.typed };
      })
      .filter((a) => a.active || a.clients > 0)
      .sort((x, y) => y.clients - x.clients || x.name.localeCompare(y.name));

    return {
      enabled: settings.enabled,
      rewardAmount: settings.rewardAmount,
      newClients,
      answered,
      skipped,
      ranking,
      unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count),
    };
  }
}

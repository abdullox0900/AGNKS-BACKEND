import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never allowed to break the caller's transaction — audit is best-effort observability. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: (entry.before ?? undefined) as object | undefined,
          after: (entry.after ?? undefined) as object | undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${entry.action}: ${(err as Error).message}`);
    }
  }
  async list(f: { actor?: string; group?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    const range: Prisma.DateTimeFilter = {};
    if (f.from) range.gte = parseDate(f.from);
    if (f.to) range.lte = parseDate(f.to);
    const prefixes = f.group ? GROUPS[f.group] : undefined;
    if (f.group && !prefixes) throw new AppError('VALIDATION_ERROR', { message: 'unknown group' });

    const rows = await this.prisma.auditLog.findMany({
      where: {
        actorId: f.actor || undefined,
        createdAt: f.from || f.to ? range : undefined,
        // datafix.unlock / failed attempts are security events, shown under their own group only
        ...(prefixes ? { OR: prefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
      },
      include: { actor: { select: { id: true, firstName: true, phone: true, roles: { select: { role: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > f.limit;
    const page = hasMore ? rows.slice(0, f.limit) : rows;
    const targets = await this.resolveTargets(page);
    // staff rows that were removed since: their user is still there (blocked or not) — name them via the snapshot's userId
    const orphanUserIds = [
      ...new Set(
        page
          .filter((r) => r.entityType === 'user_role' && !targets.has(`user_role:${r.entityId}`))
          .map((r) => (isObj(r.before) ? r.before.userId : isObj(r.after) && isObj(r.after.role) ? r.after.role.userId : undefined))
          .filter((x): x is string => typeof x === 'string'),
      ),
    ];
    const orphanUsers = orphanUserIds.length
      ? new Map((await this.prisma.user.findMany({ where: { id: { in: orphanUserIds } }, select: { id: true, firstName: true, phone: true } })).map((u) => [u.id, u]))
      : new Map<string, { firstName: string; phone: string | null }>();

    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        target:
          targets.get(`${r.entityType}:${r.entityId}`) ??
          (r.entityType === 'user_role' && isObj(r.before) && typeof r.before.userId === 'string' && orphanUsers.has(r.before.userId)
            ? [orphanUsers.get(r.before.userId)!.firstName, orphanUsers.get(r.before.userId)!.phone].filter(Boolean).join(' · ')
            : null) ??
          (r.action.startsWith('settings.') ? r.entityId : null) ??
          labelFrom(r.after) ??
          labelFrom(r.before),
        actorId: r.actorId,
        actorName: r.actor?.firstName ?? null,
        actorPhone: r.actor?.phone ?? null,
        actorRole: r.actor?.roles[0]?.role ?? null,
        changes: summarize(r.action, r.before, r.after),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async actors() {
    const grouped = await this.prisma.auditLog.groupBy({ by: ['actorId'], where: { actorId: { not: null } }, _count: { _all: true } });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.actorId!) } },
      select: { id: true, firstName: true, phone: true },
    });
    const count = new Map(grouped.map((g) => [g.actorId!, g._count._all]));
    return users.map((u) => ({ id: u.id, name: u.firstName, phone: u.phone, count: count.get(u.id) ?? 0 })).sort((a, b) => b.count - a.count);
  }

  /** Human label of the thing an entry is about ("Chilonzor", "Ali Valiyev"…), looked up in batches per type. */
  private async resolveTargets(rows: { entityType: string; entityId: string }[]) {
    const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId))];
    const out = new Map<string, string>();
    const put = (type: string, id: string, label: string | null | undefined) => {
      if (label) out.set(`${type}:${id}`, label);
    };
    const [stations, terminals, users, cards, roles, receipts] = await Promise.all([
      this.prisma.station.findMany({ where: { id: { in: ids('station') } }, select: { id: true, name: true } }),
      this.prisma.terminal.findMany({ where: { id: { in: ids('terminal') } }, select: { id: true, code: true, station: { select: { name: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: ids('user') } }, select: { id: true, firstName: true, phone: true } }),
      this.prisma.card.findMany({ where: { id: { in: ids('card') } }, select: { id: true, user: { select: { firstName: true, phone: true } } } }),
      this.prisma.userRole.findMany({ where: { id: { in: ids('user_role') } }, select: { id: true, role: true, user: { select: { firstName: true, phone: true } } } }),
      this.prisma.receipt.findMany({
        where: { id: { in: ids('receipt') } },
        select: { id: true, station: { select: { name: true } }, card: { select: { user: { select: { firstName: true } } } } },
      }),
    ]);
    stations.forEach((s) => put('station', s.id, s.name));
    terminals.forEach((t) => put('terminal', t.id, `${t.code} · ${t.station.name}`));
    users.forEach((u) => put('user', u.id, [u.firstName, u.phone].filter(Boolean).join(' · ')));
    cards.forEach((c) => put('card', c.id, [c.user.firstName, c.user.phone].filter(Boolean).join(' · ')));
    roles.forEach((r) => put('user_role', r.id, [r.user.firstName, r.user.phone].filter(Boolean).join(' · ')));
    receipts.forEach((r) => put('receipt', r.id, `${r.card.user.firstName} · ${r.station.name}`));
    return out;
  }
}

/** UI filter groups → action prefixes. */
const GROUPS: Record<string, string[]> = {
  review: ['review.', 'receipt.'],
  clients: ['client.'],
  staff: ['staff.'],
  stations: ['station.', 'terminal.'],
  rules: ['settings.', 'promotion.'],
  messages: ['broadcast.', 'feedback.', 'dispute.'],
  security: ['data.', 'datafix.'],
};

function parseDate(v: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', { message: 'invalid date' });
  return d;
}

const HIDDEN = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'password', 'pin', 'passwordEnc', 'tgUserId', 'lang', 'status']);
const hiddenKey = (k: string) => HIDDEN.has(k) || /Id$/.test(k) || /Ids$/.test(k);

type Change = { field: string; from: string | null; to: string | null };

/** One level of nesting becomes "parent.child" so {user, role} payloads read as plain fields. */
function flatten(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (hiddenKey(k)) continue;
    if (isObj(val)) {
      for (const [k2, v2] of Object.entries(val)) if (!hiddenKey(k2) && !isObj(v2)) out[`${k}.${k2}`] = v2;
    } else out[k] = val;
  }
  return out;
}

/** "Chilonzor" / "Ali · +998…" for an entry whose target row is gone (or was never a lookup type). */
function labelFrom(v: unknown): string | null {
  if (!isObj(v)) return null;
  const direct = (o: Record<string, unknown>) => {
    const name = ([o.name, o.firstName, o.code, o.title, o.textUz].find((x) => typeof x === 'string' && x) as string | undefined)?.slice(0, 60);
    const phone = typeof o.phone === 'string' ? o.phone : null;
    return name ? (phone ? `${name} · ${phone}` : name) : null;
  };
  return direct(v) ?? (isObj(v.user) ? direct(v.user) : null);
}

/** Compact "field: old → new" list. data.delete keeps full row snapshots, which never leave the server. */
function summarize(action: string, before: unknown, after: unknown): Change[] {
  if (action.startsWith('data.')) return isObj(before) && typeof before.note === 'string' ? [{ field: 'note', from: null, to: before.note.slice(0, 200) }] : [];
  const fmt = (v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 120);
    return String(v).slice(0, 120);
  };
  const b = flatten(before);
  const a = isObj(after) ? flatten(after) : after === undefined || after === null ? {} : { value: after };
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: Change[] = [];
  for (const k of keys) {
    const from = fmt(b[k]);
    const to = fmt(a[k]);
    if (from === to) continue;
    out.push({ field: k, from, to });
    if (out.length >= 12) break;
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

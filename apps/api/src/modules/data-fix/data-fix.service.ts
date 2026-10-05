import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { DashboardAuthService } from '@/modules/auth/dashboard-auth.service';
import type { StaffActor } from '@/common/types/actor';

export type RecordKind = 'receipt' | 'spend' | 'adjust';
export interface RecordRef {
  kind: RecordKind;
  id: string;
}

export interface DataRecord {
  kind: RecordKind;
  id: string;
  at: string;
  stationName: string | null;
  clientName: string;
  clientPhone: string | null;
  /** receipt: purchase amount; spend: redeemed amount; adjust: 0 */
  baseAmount: number;
  /** signed bonus effect on the balance (receipt +, spend −, adjust ±) */
  bonus: number;
  status: string;
}

export interface ClientEffect {
  userId: string;
  name: string;
  phone: string | null;
  balanceBefore: number;
  balanceAfter: number;
}

export interface Plan {
  found: number;
  missing: number;
  byKind: Record<RecordKind, number>;
  clients: ClientEffect[];
  /** a deletion would leave somebody with a negative balance — nothing is deleted in that case */
  negative: ClientEffect[];
  /** internal: what exactly is deleted */
  receiptIds: string[];
  spendIds: string[];
  adjustIds: string[];
  ledgerIds: string[];
  cardIds: string[];
}

const MAX_ITEMS = 500;
const num = (v: unknown) => Number(v ?? 0);
const safe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

/**
 * SEO-only correction tool for test / mistaken data: removes receipts, bonus redemptions and manual balance
 * adjustments, removes their bonus-ledger rows and rebuilds the affected clients' balances from what remains.
 * Everything runs in one transaction with the cards locked, needs the SEO's own password, and leaves a full
 * snapshot of what was removed in the audit log.
 */
@Injectable()
export class DataFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly auth: DashboardAuthService,
  ) {}

  async list(f: { from: Date; to: Date; stationIds?: string[]; kind?: RecordKind; q?: string; limit: number; offset: number }) {
    const like = f.q?.trim() ? `%${f.q.trim()}%` : null;
    const kind = f.kind ?? null;
    const st = (col: string) => (f.stationIds?.length ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${f.stationIds}::text[])` : Prisma.empty);
    // adjustments belong to no station — they only show when every station is selected
    const adjustsAllowed = !f.stationIds?.length;

    const base = Prisma.sql`
      SELECT 'receipt'::text AS kind, r.id, r.created_at AS at, s.name AS "stationName", u.first_name AS "clientName", u.phone AS "clientPhone",
             r.amount::bigint AS "baseAmount", r.bonus::bigint AS bonus, r.status::text AS status
      FROM receipts r JOIN stations s ON s.id = r.station_id JOIN cards c ON c.id = r.card_id JOIN users u ON u.id = c.user_id
      WHERE r.created_at BETWEEN ${f.from} AND ${f.to} ${st('r.station_id')}
      UNION ALL
      SELECT 'spend', o.id, o.created_at, s.name, u.first_name, u.phone, o.amount::bigint, (-o.amount)::bigint, o.status::text
      FROM spend_operations o JOIN stations s ON s.id = o.station_id JOIN cards c ON c.id = o.card_id JOIN users u ON u.id = c.user_id
      WHERE o.created_at BETWEEN ${f.from} AND ${f.to} ${st('o.station_id')}
      ${adjustsAllowed
        ? Prisma.sql`UNION ALL
      SELECT 'adjust', l.id, l.created_at, NULL, u.first_name, u.phone, 0::bigint, l.delta::bigint, 'applied'
      FROM bonus_ledger l JOIN cards c ON c.id = l.card_id JOIN users u ON u.id = c.user_id
      WHERE l.type = 'adjust' AND l.created_at BETWEEN ${f.from} AND ${f.to}`
        : Prisma.empty}`;

    const where = Prisma.sql`WHERE (${kind}::text IS NULL OR x.kind = ${kind}) AND (${like}::text IS NULL OR x."clientName" ILIKE ${like} OR x."clientPhone" ILIKE ${like})`;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM (${base}) x ${where} ORDER BY x.at DESC LIMIT ${f.limit} OFFSET ${f.offset}`;
    const total = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM (${base}) x ${where}`;
    const items: DataRecord[] = rows.map((r) => ({
      kind: r.kind as RecordKind,
      id: String(r.id),
      at: new Date(r.at as Date).toISOString(),
      stationName: (r.stationName as string | null) ?? null,
      clientName: String(r.clientName),
      clientPhone: (r.clientPhone as string | null) ?? null,
      baseAmount: num(r.baseAmount),
      bonus: num(r.bonus),
      status: String(r.status),
    }));
    return { items, total: num(total[0]?.n) };
  }

  /** What would happen, without changing anything. */
  async plan(items: RecordRef[], db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Plan> {
    if (items.length === 0 || items.length > MAX_ITEMS) throw new AppError('VALIDATION_ERROR', { message: `Select 1–${MAX_ITEMS} records` });
    const ids = (k: RecordKind) => [...new Set(items.filter((i) => i.kind === k).map((i) => i.id))];

    const [receipts, spends, adjusts] = await Promise.all([
      db.receipt.findMany({ where: { id: { in: ids('receipt') } }, select: { id: true, cardId: true } }),
      db.spendOperation.findMany({ where: { id: { in: ids('spend') } }, select: { id: true, cardId: true } }),
      db.bonusLedger.findMany({ where: { id: { in: ids('adjust') }, type: 'adjust' }, select: { id: true, cardId: true } }),
    ]);
    const receiptIds = receipts.map((r) => r.id);
    const spendIds = spends.map((s) => s.id);
    const adjustIds = adjusts.map((a) => a.id);

    // ledger rows that go away with them: a receipt's earn row, a spend's spend + reverse rows, the adjustment itself
    const ledgerRows = await db.bonusLedger.findMany({
      where: {
        OR: [
          ...(receiptIds.length ? [{ refType: 'receipt' as const, refId: { in: receiptIds } }] : []),
          ...(spendIds.length ? [{ refType: 'spend' as const, refId: { in: spendIds } }] : []),
          ...(adjustIds.length ? [{ id: { in: adjustIds } }] : []),
        ],
      },
      select: { id: true, cardId: true, delta: true },
    });

    const cardIds = [...new Set([...receipts, ...spends, ...adjusts].map((r) => r.cardId).concat(ledgerRows.map((l) => l.cardId)))];
    const cards = cardIds.length ? await db.card.findMany({ where: { id: { in: cardIds } }, include: { user: true } }) : [];
    const removedByCard = new Map<string, bigint>();
    for (const l of ledgerRows) removedByCard.set(l.cardId, (removedByCard.get(l.cardId) ?? 0n) + l.delta);

    const clients: ClientEffect[] = cards.map((c) => ({
      userId: c.userId,
      name: c.user.firstName,
      phone: c.user.phone,
      balanceBefore: Number(c.cachedBalance),
      balanceAfter: Number(c.cachedBalance - (removedByCard.get(c.id) ?? 0n)),
    }));

    return {
      found: receipts.length + spends.length + adjusts.length,
      missing: ids('receipt').length + ids('spend').length + ids('adjust').length - (receipts.length + spends.length + adjusts.length),
      byKind: { receipt: receipts.length, spend: spends.length, adjust: adjusts.length },
      clients,
      negative: clients.filter((c) => c.balanceAfter < 0),
      receiptIds,
      spendIds,
      adjustIds,
      ledgerIds: ledgerRows.map((l) => l.id),
      cardIds,
    };
  }

  async preview(items: RecordRef[]) {
    const { receiptIds: _r, spendIds: _s, adjustIds: _a, ledgerIds: _l, cardIds: _c, ...visible } = await this.plan(items);
    return visible;
  }

  async remove(items: RecordRef[], opts: { password: string; note: string }, actor: StaffActor) {
    if (!(await this.auth.verifyPassword(actor.userId, opts.password))) throw new AppError('AUTH_INVALID_CREDENTIALS');

    return this.prisma.$transaction(
      async (tx) => {
        const first = await this.plan(items, tx);
        // lock every affected card (stable order), then plan again so the numbers are the ones we act on
        if (first.cardIds.length) await tx.$queryRaw`SELECT id FROM cards WHERE id = ANY(${[...first.cardIds].sort()}::text[]) ORDER BY id FOR UPDATE`;
        const plan = await this.plan(items, tx);
        if (plan.found === 0) throw new AppError('NOT_FOUND');
        if (plan.negative.length) throw new AppError('VALIDATION_ERROR', { message: 'would_go_negative', clients: plan.negative.map((c) => c.name) });

        // snapshot for the audit log BEFORE anything is removed
        const [receiptRows, spendRows, ledgerRows, disputeRows] = await Promise.all([
          tx.receipt.findMany({ where: { id: { in: plan.receiptIds } }, select: { id: true, cardId: true, stationId: true, amount: true, bonus: true, status: true, qrT: true, qrR: true, createdAt: true } }),
          tx.spendOperation.findMany({ where: { id: { in: plan.spendIds } } }),
          tx.bonusLedger.findMany({ where: { id: { in: plan.ledgerIds } } }),
          tx.dispute.findMany({ where: { OR: [{ refType: 'receipt', refId: { in: plan.receiptIds } }, { refType: 'spend', refId: { in: plan.spendIds } }] } }),
        ]);

        await tx.dispute.deleteMany({ where: { id: { in: disputeRows.map((d) => d.id) } } });
        await tx.bonusLedger.deleteMany({ where: { id: { in: plan.ledgerIds } } });
        await tx.spendOperation.deleteMany({ where: { id: { in: plan.spendIds } } });
        await tx.receipt.deleteMany({ where: { id: { in: plan.receiptIds } } });
        for (const cardId of plan.cardIds) await this.ledger.rebuildCard(tx, cardId);

        await tx.auditLog.create({
          data: {
            actorId: actor.userId,
            action: 'data.delete',
            entityType: 'data_fix',
            entityId: plan.cardIds.join(',').slice(0, 200) || 'none',
            before: safe({ note: opts.note, receipts: receiptRows, spends: spendRows, ledger: ledgerRows, disputes: disputeRows }),
            after: safe({ byKind: plan.byKind, clients: plan.clients }),
          },
        });

        return { deleted: plan.found, byKind: plan.byKind, clients: plan.clients };
      },
      { timeout: 30_000 },
    );
  }
}

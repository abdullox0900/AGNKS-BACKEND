import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AuditService } from '@/modules/audit/audit.service';

@Injectable()
export class AdminClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async search(q?: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.user.findMany({
      where: q
        ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
        : undefined,
      include: { card: true },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /** Full client profile: identity, card, and lifetime statistics (all numbers plain JS numbers). */
  async detail(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');
    const card = user.card;

    const [byStatus, applied, spends, lastReceipt, firstReceipt, feedbackCount, disputeCount, marketing] = await Promise.all([
      this.prisma.receipt.groupBy({ by: ['status'], where: { cardId: card.id }, _count: { _all: true } }),
      this.prisma.receipt.aggregate({
        where: { cardId: card.id, status: 'applied' },
        _sum: { amount: true, bonus: true },
      }),
      this.prisma.spendOperation.aggregate({
        where: { cardId: card.id, status: 'applied' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.receipt.findFirst({ where: { cardId: card.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.receipt.findFirst({ where: { cardId: card.id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.feedback.count({ where: { cardId: card.id } }),
      this.prisma.dispute.count({ where: { cardId: card.id } }),
      this.prisma.consent.findFirst({
        where: { userId: user.id, type: 'marketing' },
        orderBy: { acceptedAt: 'desc' },
        select: { revokedAt: true },
      }),
    ]);

    const count = (status: string) => byStatus.find((r) => r.status === status)?._count._all ?? 0;

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        phone: user.phone,
        lang: user.lang,
        status: user.status,
        registeredAt: user.registeredAt,
        createdAt: user.createdAt,
        telegramLinked: user.tgUserId !== null,
        marketingOptIn: !!marketing && !marketing.revokedAt,
      },
      card: {
        number: card.number,
        balance: Number(card.cachedBalance),
        pending: Number(card.pendingAmount),
        blocked: card.blocked,
        lastActivityAt: card.lastActivityAt,
        createdAt: card.createdAt,
      },
      stats: {
        receiptsTotal: byStatus.reduce((sum, r) => sum + r._count._all, 0),
        receiptsApplied: count('applied'),
        receiptsPending: count('pending_review'),
        receiptsRejected: count('rejected'),
        receiptsSum: Number(applied._sum.amount ?? 0),
        bonusEarned: Number(applied._sum.bonus ?? 0),
        spendCount: spends._count._all,
        spendSum: Number(spends._sum.amount ?? 0),
        feedbackCount,
        disputeCount,
        firstReceiptAt: firstReceipt?.createdAt ?? null,
        lastReceiptAt: lastReceipt?.createdAt ?? null,
      },
    };
  }

  /**
   * Whole activity timeline of a client — scanned receipts (any status), bonus spends and manual
   * balance adjustments — newest first, cursor-paginated by createdAt.
   */
  async history(id: string, opts: { cursor?: string; limit?: number; type?: 'receipt' | 'spend' | 'adjust' }) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');
    const cardId = user.card.id;
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const before = opts.cursor ? decodeCursor(opts.cursor) : null;
    const createdAt = before ? { lt: before } : undefined;
    const { type } = opts;

    const [receipts, spends, adjusts] = await Promise.all([
      type && type !== 'receipt'
        ? []
        : this.prisma.receipt.findMany({
            where: { cardId, createdAt },
            include: { station: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
      type && type !== 'spend'
        ? []
        : this.prisma.spendOperation.findMany({
            where: { cardId, createdAt },
            include: { station: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
      type && type !== 'adjust'
        ? []
        : this.prisma.bonusLedger.findMany({
            where: { cardId, type: 'adjust', createdAt },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
    ]);

    const staffIds = [...new Set([...spends.map((s) => s.cashierId), ...adjusts.map((a) => a.actorId).filter((v): v is string => !!v)])];
    const [staff, adjustAudit] = await Promise.all([
      staffIds.length ? this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true } }) : [],
      adjusts.length
        ? this.prisma.auditLog.findMany({ where: { entityType: 'card', entityId: cardId, action: 'client.adjust' }, orderBy: { createdAt: 'desc' }, take: 200 })
        : [],
    ]);
    const staffName = new Map(staff.map((u) => [u.id, u.firstName]));
    const noteByBalance = new Map<string, string>();
    for (const a of adjustAudit) {
      const after = a.after as { balanceAfter?: string; note?: string } | null;
      if (after?.balanceAfter !== undefined && after.note) noteByBalance.set(String(after.balanceAfter), after.note);
    }

    const merged = [
      ...receipts.map((r) => ({
        kind: 'receipt' as const,
        id: r.id,
        createdAt: r.createdAt,
        stationName: r.station.name,
        amount: Number(r.amount),
        bonus: Number(r.bonus),
        ratePercent: r.rateBps / 100,
        status: r.status as string,
        taxVerified: r.taxVerified,
        note: r.reviewNote,
        actorName: null as string | null,
      })),
      ...spends.map((sp) => ({
        kind: 'spend' as const,
        id: sp.id,
        createdAt: sp.createdAt,
        stationName: sp.station.name,
        amount: Number(sp.amount),
        bonus: -Number(sp.amount),
        ratePercent: null as number | null,
        status: sp.status as string,
        taxVerified: null as boolean | null,
        note: sp.reverseReason,
        actorName: staffName.get(sp.cashierId) ?? null,
      })),
      ...adjusts.map((a) => ({
        kind: 'adjust' as const,
        id: a.id,
        createdAt: a.createdAt,
        stationName: null as string | null,
        amount: 0,
        bonus: Number(a.delta),
        ratePercent: null as number | null,
        status: 'applied' as string,
        taxVerified: null as boolean | null,
        note: noteByBalance.get(a.balanceAfter.toString()) ?? null,
        actorName: a.actorId ? staffName.get(a.actorId) ?? null : null,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const page = merged.slice(0, limit);
    const nextCursor = page.length === limit ? encodeCursor(page[page.length - 1].createdAt) : null;
    return { items: page.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })), nextCursor };
  }

  async rename(id: string, firstName: string, actorId: string) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');

    const user = await this.prisma.user.update({ where: { id }, data: { firstName } });
    await this.audit.record({ actorId, action: 'client.rename', entityType: 'user', entityId: id, before, after: user });
    return user;
  }

  async adjust(id: string, delta: number, note: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const result = await this.prisma.$transaction(async (tx) => {
      const posted = await this.ledger.post(tx, {
        cardId: user.card!.id,
        delta: BigInt(delta),
        type: 'adjust',
        refType: 'manual',
        refId: id,
        actorId,
      });
      return posted;
    });

    await this.audit.record({
      actorId,
      action: 'client.adjust',
      entityType: 'card',
      entityId: user.card.id,
      after: { delta, note, balanceAfter: result.balanceAfter.toString() },
    });

    return { balanceAfter: Number(result.balanceAfter) };
  }

  async setBlocked(id: string, blocked: boolean, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const card = await this.prisma.card.update({ where: { id: user.card.id }, data: { blocked } });

    await this.audit.record({
      actorId,
      action: blocked ? 'client.block' : 'client.unblock',
      entityType: 'card',
      entityId: card.id,
    });

    return card;
  }
}

function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string): Date {
  const date = new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', { message: 'invalid cursor' });
  return date;
}

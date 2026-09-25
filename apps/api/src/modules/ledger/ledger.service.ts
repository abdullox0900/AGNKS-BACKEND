import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError, type LedgerRefType, type LedgerType } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface PostLedgerInput {
  cardId: string;
  delta: bigint;
  type: LedgerType;
  refType: LedgerRefType;
  refId: string;
  actorId?: string | null;
}

export interface PostLedgerResult {
  balanceAfter: bigint;
  entryId: string;
}

/**
 * The only place `cards.cached_balance` is allowed to change (TZ-4 §5.3).
 * `SELECT ... FOR UPDATE` serializes concurrent posts to the same card so two
 * parallel spends can never both read the same starting balance — the
 * pending-spend-under-parallel-load race test in TZ-4 §12 depends on this.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Must be called from within an active transaction (`prisma.$transaction`). */
  async post(tx: Tx, input: PostLedgerInput): Promise<PostLedgerResult> {
    // Prisma's default `@id` String maps to a plain `text` column (no native
    // `uuid` cast needed or wanted here — casting would break the comparison).
    const locked = await tx.$queryRaw<{ cached_balance: bigint }[]>`
      SELECT cached_balance FROM cards WHERE id = ${input.cardId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError('NOT_FOUND', { entity: 'card' });
    }

    const currentBalance = locked[0].cached_balance;
    const balanceAfter = currentBalance + input.delta;
    if (balanceAfter < 0n) {
      throw new AppError('SPEND_INSUFFICIENT_BALANCE', { balance: currentBalance.toString() });
    }

    const entry = await tx.bonusLedger.create({
      data: {
        cardId: input.cardId,
        delta: input.delta,
        type: input.type,
        balanceAfter,
        refType: input.refType,
        refId: input.refId,
        actorId: input.actorId ?? null,
      },
    });

    await tx.card.update({
      where: { id: input.cardId },
      data: { cachedBalance: balanceAfter, lastActivityAt: new Date() },
    });

    return { balanceAfter, entryId: entry.id };
  }

  async adjustPending(tx: Tx, cardId: string, delta: bigint): Promise<void> {
    await tx.card.update({
      where: { id: cardId },
      data: { pendingAmount: { increment: delta } },
    });
  }

  async history(cardId: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.bonusLedger.findMany({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /** Nightly self-check (TZ-4 §5.3.4 / job `ledger.reconcile`): SUM(delta) must equal cached_balance. */
  async findDrift(): Promise<{ cardId: string; sumDelta: bigint; cachedBalance: bigint }[]> {
    return this.prisma.$queryRaw`
      SELECT c.id AS "cardId", COALESCE(SUM(l.delta), 0) AS "sumDelta", c.cached_balance AS "cachedBalance"
      FROM cards c
      LEFT JOIN bonus_ledger l ON l.card_id = c.id
      GROUP BY c.id, c.cached_balance
      HAVING COALESCE(SUM(l.delta), 0) != c.cached_balance
    `;
  }
}

import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { RedisService } from '@/infra/redis/redis.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { tashkentDayRange } from '@/common/lib/tashkent-time';
import { SpendTokenService } from './spend-token.service';
import { SpendSessionService } from './spend-session.service';

const LOOKUP_RATE_PER_MIN = 10;
const LOOKUP_FAIL_LIMIT = 5;
const LOOKUP_FAIL_BLOCK_S = 5 * 60;
const VOID_WINDOW_FALLBACK_MIN = 5;

@Injectable()
export class SpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly tokens: SpendTokenService,
    private readonly sessions: SpendSessionService,
  ) {}

  async issueToken(cardId: string) {
    return this.tokens.issue(cardId);
  }

  async lookup(cashierId: string, code: string) {
    const shift = await this.getOrOpenShift(cashierId);
    await this.enforceLookupRateLimit(cashierId);

    let cardId: string;
    try {
      cardId = await this.tokens.consume(code);
    } catch (err) {
      await this.registerLookupFailure(cashierId);
      throw err;
    }

    const card = await this.prisma.card.findUnique({ where: { id: cardId }, include: { user: true } });
    if (!card) throw new AppError('SPEND_TOKEN_INVALID');
    if (card.blocked) throw new AppError('CARD_BLOCKED');

    const [minAmount, maxAmount, dailyLimit] = await Promise.all([
      this.settings.get('spend.min_amount'),
      this.settings.get('spend.max_amount'),
      this.settings.get('spend.daily_limit'),
    ]);
    const spentToday = await this.spentToday(cardId);
    const dailyRemaining = Math.max(0, dailyLimit - Number(spentToday));

    const session = await this.sessions.create({
      cardId,
      cashierId,
      stationId: shift.stationId,
      shiftId: shift.id,
    });

    return {
      sessionId: session.sessionId,
      client: { name: displayName(card.user.firstName) },
      balance: Number(card.cachedBalance),
      minAmount,
      maxAmount,
      dailyRemaining,
      expiresAt: session.expiresAt,
    };
  }

  async submit(cashierId: string, sessionId: string, amount: number) {
    const session = await this.sessions.get(sessionId);
    if (session.cashierId !== cashierId) {
      throw new AppError('SPEND_SESSION_EXPIRED');
    }
    await this.sessions.consume(sessionId);

    const amt = BigInt(amount);
    const [minAmount, maxAmount, dailyLimit] = await Promise.all([
      this.settings.get('spend.min_amount'),
      this.settings.get('spend.max_amount'),
      this.settings.get('spend.daily_limit'),
    ]);
    if (amt < BigInt(minAmount)) throw new AppError('SPEND_BELOW_MIN', { min: minAmount });
    if (amt > BigInt(maxAmount)) throw new AppError('SPEND_ABOVE_MAX', { max: maxAmount });

    const spentToday = await this.spentToday(session.cardId);
    if (Number(spentToday) + amount > dailyLimit) {
      throw new AppError('SPEND_DAILY_LIMIT', { remaining: Math.max(0, dailyLimit - Number(spentToday)) });
    }

    const card = await this.prisma.card.findUnique({ where: { id: session.cardId } });
    if (!card) throw new AppError('SPEND_TOKEN_INVALID');
    if (card.blocked) throw new AppError('CARD_BLOCKED');

    const result = await this.prisma.$transaction(async (tx) => {
      const op = await tx.spendOperation.create({
        data: {
          cardId: session.cardId,
          cashierId,
          stationId: session.stationId,
          shiftId: session.shiftId,
          amount: amt,
        },
      });

      const posted = await this.ledger.post(tx, {
        cardId: session.cardId,
        delta: -amt,
        type: 'spend',
        refType: 'spend',
        refId: op.id,
        actorId: cashierId,
      });

      await this.notifications.enqueue(
        'client.spend_applied',
        { cardId: session.cardId, amount: amt.toString(), balanceAfter: posted.balanceAfter.toString() },
        tx,
      );

      return { op, balanceAfter: posted.balanceAfter };
    });

    return {
      id: result.op.id,
      amount: Number(amt),
      balanceAfter: Number(result.balanceAfter),
    };
  }

  async void(cashierId: string, spendId: string, reason: string) {
    const op = await this.prisma.spendOperation.findUnique({ where: { id: spendId } });
    if (!op || op.cashierId !== cashierId) {
      throw new AppError('NOT_FOUND');
    }
    if (op.status === 'reversed') {
      return op;
    }

    const voidWindowMin = await this.settings.get('spend.void_window_min').catch(() => VOID_WINDOW_FALLBACK_MIN);
    if (Date.now() - op.createdAt.getTime() > voidWindowMin * 60_000) {
      throw new AppError('VOID_WINDOW_EXPIRED');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const posted = await this.ledger.post(tx, {
        cardId: op.cardId,
        delta: op.amount,
        type: 'reverse',
        refType: 'spend',
        refId: op.id,
        actorId: cashierId,
      });

      const spend = await tx.spendOperation.update({
        where: { id: spendId },
        data: { status: 'reversed', reversedBy: cashierId, reversedAt: new Date(), reverseReason: reason },
      });

      void posted;
      return spend;
    });

    return updated;
  }

  async listForShift(cashierId: string, shiftId?: string) {
    const rows = await this.prisma.spendOperation.findMany({
      where: { cashierId, shiftId },
      orderBy: { createdAt: 'desc' },
      include: { card: { include: { user: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      clientName: displayName(r.card.user.firstName),
      amount: Number(r.amount),
      status: r.status,
      voidReason: r.reverseReason,
    }));
  }

  private async spentToday(cardId: string): Promise<bigint> {
    const { start, end } = tashkentDayRange();
    const agg = await this.prisma.spendOperation.aggregate({
      where: { cardId, status: 'applied', createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0n;
  }

  /**
   * There's no cash to reconcile in this system — a cashier "shift" only exists so spend
   * operations have a station/time grouping (for the dashboard's activity view), so it's
   * opened silently on first use rather than through an explicit open/close step. One shift
   * per cashier per calendar day (Tashkent time); a stale one from an earlier day is closed
   * out automatically.
   */
  private async getOrOpenShift(cashierId: string) {
    const { start } = tashkentDayRange();
    let shift = await this.prisma.shift.findFirst({ where: { cashierId, status: 'open' } });
    if (shift && shift.openedAt < start) {
      await this.prisma.shift.update({ where: { id: shift.id }, data: { status: 'closed', closedAt: new Date() } });
      shift = null;
    }
    if (!shift) {
      const role = await this.prisma.userRole.findFirst({ where: { userId: cashierId, role: 'cashier' } });
      if (!role || !role.stationId) throw new AppError('AUTH_STAFF_NOT_FOUND');
      shift = await this.prisma.shift.create({
        data: { stationId: role.stationId, cashierId, terminalIds: role.terminalIds },
      });
    }
    return shift;
  }

  private async enforceLookupRateLimit(cashierId: string): Promise<void> {
    const blocked = await this.redis.safeGet(`lookup_block:${cashierId}`);
    if (blocked) throw new AppError('RATE_LIMITED');

    const count = await this.redis.safeIncr(`lookup_rl:${cashierId}`, 60);
    if (count !== null && count > LOOKUP_RATE_PER_MIN) {
      throw new AppError('RATE_LIMITED');
    }
  }

  private async registerLookupFailure(cashierId: string): Promise<void> {
    const fails = await this.redis.safeIncr(`lookup_fail:${cashierId}`, LOOKUP_FAIL_BLOCK_S);
    if (fails !== null && fails >= LOOKUP_FAIL_LIMIT) {
      await this.redis.safeSet(`lookup_block:${cashierId}`, '1', LOOKUP_FAIL_BLOCK_S);
      const shift = await this.prisma.shift.findFirst({ where: { cashierId, status: 'open' } });
      await this.notifications.enqueue('staff.anomaly', {
        cashierId,
        stationId: shift?.stationId,
        reason: 'too_many_invalid_spend_codes',
      });
    }
  }
}

function displayName(firstName: string): string {
  return firstName || 'Mijoz';
}

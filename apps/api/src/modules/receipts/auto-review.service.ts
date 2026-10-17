import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, type AutoReviewSettingsDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AuditService } from '@/modules/audit/audit.service';
import { calcBonus } from '@/common/lib/money';
import { SoliqFetchService, evaluateSoliqData, type SoliqCheckResult } from './soliq-fetch.service';
import { buildSoliqUrl } from './qr-parser';

/** The server gives up after this many of its own tries (the receipt then stays in the queue for a person). */
const MAX_SERVER_ATTEMPTS = 6;
const PER_RUN = 10;
const CONCURRENCY = 5;
/** a phone may re-check the same receipt at most this often */
const PHONE_COOLDOWN_MS = 2 * 60_000;
const SERVER_TIMEOUT_MS = 6000;

type WaitingReceipt = {
  id: string;
  cardId: string;
  qrT: string;
  qrR: string;
  qrC: string;
  qrS: string;
  rateBps: number;
  reviewReasons: string[];
};

/**
 * "Avto-tekshiruv": receipts soliq.uz could not confirm at scan time (not registered there yet, phone offline…)
 * are re-checked later by the program and the bonus is credited without a person.
 *
 * Two ways a receipt gets re-checked, both after the configured delay:
 *  - the server asks soliq.uz itself (works only when the server can reach it — soliq.uz answers Uzbek IPs only);
 *  - the client's phone does it the next time the app is opened (`GET/POST /me/receipts/recheck`).
 * Either way the record must match the receipt's own QR (terminal / number / date) — same trust rule as at submit time.
 */
@Injectable()
export class AutoReviewService {
  private readonly logger = new Logger(AutoReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly soliq: SoliqFetchService,
    private readonly audit: AuditService,
  ) {}

  async getSettings() {
    const [enabled, delayMin] = await Promise.all([this.settings.get('receipt.auto_review'), this.settings.get('receipt.auto_review_delay_min')]);
    return { enabled, delayMin };
  }

  async updateSettings(dto: AutoReviewSettingsDto, actorId: string) {
    if (dto.delayMin !== undefined) await this.settings.set('receipt.auto_review_delay_min', dto.delayMin, actorId);
    if (dto.enabled !== undefined) await this.settings.set('receipt.auto_review', dto.enabled, actorId);
    return this.getSettings();
  }

  /** Waiting receipts whose last check (or creation) is older than the delay; refunds never come back as valid. */
  private dueWhere(delayMin: number, now = Date.now()): Prisma.ReceiptWhereInput {
    const cutoff = new Date(now - delayMin * 60_000);
    return {
      status: 'pending_review',
      NOT: { reviewReasons: { has: 'tax_refund' } },
      AND: [{ OR: [{ autoCheckedAt: null, createdAt: { lte: cutoff } }, { autoCheckedAt: { lte: cutoff } }] }],
    };
  }

  /** Worker tick. */
  async runDue(): Promise<{ checked: number; approved: number }> {
    const { enabled, delayMin } = await this.getSettings();
    if (!enabled) return { checked: 0, approved: 0 };

    const rows = await this.prisma.receipt.findMany({
      where: { ...this.dueWhere(delayMin), autoAttempts: { lt: MAX_SERVER_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: PER_RUN,
    });
    let approved = 0;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const results = await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) => this.checkOnServer(r)));
      approved += results.filter(Boolean).length;
    }
    if (rows.length) this.logger.log(`auto-review: ${rows.length} checked, ${approved} approved`);
    return { checked: rows.length, approved };
  }

  private async checkOnServer(r: WaitingReceipt): Promise<boolean> {
    const parsed = { t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS, url: buildSoliqUrl({ t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS }) };
    const tax = await this.soliq.fetchAmount(parsed.url, parsed, SERVER_TIMEOUT_MS);
    return this.finish(r, tax, 'server', true);
  }

  // ------------------------------------------------------------------ client phone

  /** Receipts of this client that the phone may re-check now (soliq.uz answers Uzbek IPs, the server's lookup does not). */
  async listForPhone(cardId: string) {
    const { enabled, delayMin } = await this.getSettings();
    if (!enabled) return { items: [] };
    const rows = await this.prisma.receipt.findMany({
      where: { cardId, ...this.phoneWhere(delayMin) },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return { items: rows.map((r) => ({ id: r.id, t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS })) };
  }

  /** The phone tries once the receipt is old enough and not more often than the cooldown. */
  private phoneWhere(delayMin: number, now = Date.now()): Prisma.ReceiptWhereInput {
    return {
      status: 'pending_review',
      NOT: { reviewReasons: { has: 'tax_refund' } },
      createdAt: { lte: new Date(now - delayMin * 60_000) },
      OR: [{ autoCheckedAt: null }, { autoCheckedAt: { lte: new Date(now - PHONE_COOLDOWN_MS) } }],
    };
  }

  async recheckFromPhone(cardId: string, receiptId: string, soliqData: Record<string, unknown>) {
    const { enabled, delayMin } = await this.getSettings();
    if (!enabled) throw new AppError('NOT_FOUND');
    const r = await this.prisma.receipt.findUnique({ where: { id: receiptId } });
    if (!r || r.cardId !== cardId) throw new AppError('NOT_FOUND');
    if (r.status !== 'pending_review') return { status: r.status };
    if (r.autoCheckedAt && Date.now() - r.autoCheckedAt.getTime() < PHONE_COOLDOWN_MS) return { status: r.status };
    if (Date.now() - r.createdAt.getTime() < delayMin * 60_000) return { status: r.status };

    const tax = evaluateSoliqData(soliqData, { t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS, url: buildSoliqUrl({ t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS }) });
    await this.finish(r, tax, 'client', false);
    const after = await this.prisma.receipt.findUnique({ where: { id: receiptId }, select: { status: true } });
    return { status: after?.status ?? r.status };
  }

  // ------------------------------------------------------------------ shared

  /** Credits the bonus when soliq.uz confirmed the receipt; otherwise just remembers that we tried. */
  private async finish(r: WaitingReceipt, tax: SoliqCheckResult, source: 'server' | 'client', countServerAttempt: boolean): Promise<boolean> {
    if (!tax.verified || tax.amount === null) {
      await this.prisma.receipt.updateMany({
        where: { id: r.id, status: 'pending_review' },
        data: {
          autoCheckedAt: new Date(),
          ...(countServerAttempt ? { autoAttempts: { increment: 1 } } : {}),
          // keep the reviewer's hint current (a refund must not be retried again)
          ...(tax.reason === 'tax_refund' ? { reviewReasons: ['tax_refund'] } : {}),
          ...(tax.data && tax.reason !== 'tax_mismatch' ? { taxData: tax.data as Prisma.InputJsonValue, taxSource: source } : {}),
        },
      });
      return false;
    }

    const amount = tax.amount;
    const bonus = calcBonus(amount, r.rateBps);
    const applied = await this.prisma.$transaction(async (tx) => {
      // only one of {a person, the server, the phone} may decide a receipt
      const claimed = await tx.receipt.updateMany({
        where: { id: r.id, status: 'pending_review' },
        data: {
          status: 'applied',
          amount,
          bonus,
          taxAmount: amount,
          taxVerified: true,
          taxCheckedAt: new Date(),
          taxData: (tax.data ?? undefined) as Prisma.InputJsonValue | undefined,
          taxSource: source,
          reviewedAt: new Date(),
          autoReviewed: true,
          autoCheckedAt: new Date(),
        },
      });
      if (claimed.count === 0) return null;
      const posted = await this.ledger.post(tx, { cardId: r.cardId, delta: bonus, type: 'earn', refType: 'receipt', refId: r.id, actorId: null });
      await this.notifications.enqueue(
        'client.receipt_applied',
        { cardId: r.cardId, receiptId: r.id, bonus: bonus.toString(), balanceAfter: posted.balanceAfter.toString() },
        tx,
      );
      return posted;
    });
    if (!applied) return false;

    await this.audit.record({
      actorId: null,
      action: 'review.auto_approve',
      entityType: 'receipt',
      entityId: r.id,
      after: { amount: amount.toString(), bonus: bonus.toString(), source },
    });
    return true;
  }
}

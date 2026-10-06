import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, type SubmitReceiptDto, type SubmitReceiptResponse } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { RateResolverService } from '@/modules/rules/rate-resolver.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AuditService } from '@/modules/audit/audit.service';
import { distanceMeters } from '@/common/lib/geo';
import { calcBonus } from '@/common/lib/money';
import { SoliqFetchService, evaluateSoliqData } from './soliq-fetch.service';
import { buildSoliqUrl, parseManualReceiptFields, parseReceiptQr, parseReceiptTimestamp, type ParsedReceiptQr } from './qr-parser';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
// When the webapp already sent soliq.uz's record, don't make the client wait long on our
// own lookup (it times out from servers outside Uzbekistan anyway).
const CLIENT_DATA_SERVER_TIMEOUT_MS = 1500;

interface PreCheckResult {
  parsed: ParsedReceiptQr;
  receiptAt: Date;
  terminal: { id: string; stationId: string; code: string; active: boolean };
  station: { id: string; name: string; lat: number; lng: number; radiusM: number };
}

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly rateResolver: RateResolverService,
    private readonly notifications: NotificationsService,
    private readonly soliq: SoliqFetchService,
    private readonly audit: AuditService,
  ) {}

  async parse(qrText: string) {
    const parsed = parseReceiptQr(qrText);
    const check = await this.preCheck(parsed);
    return {
      station: { id: check.station.id, name: check.station.name },
      terminal: { id: check.terminal.id, label: check.terminal.code },
      receiptAt: check.receiptAt.toISOString(),
    };
  }

  async submit(
    cardId: string,
    dto: SubmitReceiptDto,
  ): Promise<SubmitReceiptResponse> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (card?.blocked) throw new AppError('CARD_BLOCKED');

    const parsed = dto.qrText ? parseReceiptQr(dto.qrText) : parseManualReceiptFields(dto.manual!);
    const check = await this.preCheck(parsed);

    const locationPolicy = await this.settings.get('location.policy');
    let distanceM: number | null = null;
    if (dto.lat !== undefined && dto.lng !== undefined) {
      distanceM = Math.round(distanceMeters(dto.lat, dto.lng, check.station.lat, check.station.lng));
    } else if (locationPolicy === 'required') {
      throw new AppError('LOCATION_REQUIRED');
    }
    if (distanceM !== null && locationPolicy !== 'off' && distanceM > check.station.radiusM) {
      throw new AppError('LOCATION_TOO_FAR', { distanceM });
    }

    const { rateBps, promotionId } = await this.rateResolver.resolve(check.station.id, check.receiptAt);

    // The receipt total only ever comes from soliq.uz's payment record — never typed in.
    // Our own lookup goes first; soliq.uz doesn't answer servers outside Uzbekistan, so the
    // webapp also fetches the record from the client's phone and sends it along
    // (dto.soliqData). That one is accepted only if it matches the QR we parsed ourselves.
    // If neither works, the receipt waits for a reviewer.
    const serverTax = await this.soliq.fetchAmount(
      parsed.url ?? buildSoliqUrl(parsed),
      parsed,
      dto.soliqData ? CLIENT_DATA_SERVER_TIMEOUT_MS : undefined,
    );
    let tax = serverTax;
    let taxSource: 'server' | 'client' | null = serverTax.verified ? 'server' : null;
    if (!serverTax.verified && dto.soliqData) {
      tax = evaluateSoliqData(dto.soliqData, parsed);
      taxSource = 'client';
    }
    const verified = tax.verified && tax.amount !== null;
    const amount = verified ? tax.amount! : 0n;
    const bonus = verified ? calcBonus(amount, rateBps) : 0n;
    const status = verified ? 'applied' : 'pending_review';
    const reviewReasons = verified ? [] : [tax.reason ?? 'tax_unverified'];

    const result = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.create({
        data: {
          cardId,
          stationId: check.station.id,
          terminalId: check.terminal.id,
          qrT: parsed.t,
          qrR: parsed.r,
          qrC: parsed.c,
          qrS: parsed.s,
          receiptAt: check.receiptAt,
          amount,
          rateBps,
          promotionId,
          bonus,
          taxAmount: tax.amount,
          taxVerified: tax.verified,
          taxCheckedAt: tax.verified ? new Date() : null,
          taxData: (tax.data ?? undefined) as Prisma.InputJsonValue | undefined,
          taxSource: tax.data ? taxSource ?? 'server' : null,
          clientLat: dto.lat,
          clientLng: dto.lng,
          distanceM,
          status,
          reviewReasons,
        },
      });

      let balanceAfter: bigint | undefined;
      if (status === 'applied') {
        const posted = await this.ledger.post(tx, {
          cardId,
          delta: bonus,
          type: 'earn',
          refType: 'receipt',
          refId: receipt.id,
          actorId: null,
        });
        balanceAfter = posted.balanceAfter;
      }

      await this.notifications.enqueue(
        status === 'applied' ? 'client.receipt_applied' : 'client.receipt_pending',
        { cardId, receiptId: receipt.id, bonus: bonus.toString(), ...(balanceAfter !== undefined ? { balanceAfter: balanceAfter.toString() } : {}) },
        tx,
      );

      return { receipt, balanceAfter };
    });

    return {
      id: result.receipt.id,
      status: result.receipt.status,
      bonus: Number(bonus),
      rateBps,
      balanceAfter: result.balanceAfter !== undefined ? Number(result.balanceAfter) : undefined,
    };
  }

  async getById(cardId: string, id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt || receipt.cardId !== cardId) throw new AppError('NOT_FOUND');
    return receipt;
  }

  /** The soliq.uz fiscal-check link for a receipt — reviewers use it to read the real amount by hand. */
  soliqLink(receipt: { qrT: string; qrR: string; qrC: string; qrS: string }): string {
    return buildSoliqUrl({ t: receipt.qrT, r: receipt.qrR, c: receipt.qrC, s: receipt.qrS });
  }

  /**
   * Everything known about one receipt of a client, for the dashboard: our own record plus the
   * complete soliq.uz payment record. Receipts saved before soliq data was stored get a live lookup.
   */
  async adminClientReceipt(userId: string, receiptId: string) {
    const r = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { station: true, terminal: true, promotion: true, card: { include: { user: true } } },
    });
    if (!r || r.card.userId !== userId) throw new AppError('NOT_FOUND');

    let taxData = (r.taxData ?? null) as Record<string, unknown> | null;
    let taxDataSource: 'stored' | 'live' | null = taxData ? 'stored' : null;
    const soliqUrl = this.soliqLink(r);
    if (!taxData) {
      const live = await this.soliq.fetchAmount(soliqUrl, { t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS, url: soliqUrl }, 6000);
      if (live.data) {
        taxData = live.data;
        taxDataSource = 'live';
      }
    }

    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      receiptAt: r.receiptAt.toISOString(),
      client: { id: r.card.user.id, name: r.card.user.firstName, phone: r.card.user.phone },
      station: { id: r.station.id, name: r.station.name, address: r.station.address },
      terminal: { code: r.terminal.code, label: r.terminal.label },
      amount: Number(r.amount),
      bonus: Number(r.bonus),
      ratePercent: r.rateBps / 100,
      promotionName: r.promotion?.name ?? null,
      taxAmount: r.taxAmount === null ? null : Number(r.taxAmount),
      taxVerified: r.taxVerified,
      taxCheckedAt: r.taxCheckedAt?.toISOString() ?? null,
      taxSource: r.taxSource,
      reviewReasons: r.reviewReasons,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      distanceM: r.distanceM,
      qr: { t: r.qrT, r: r.qrR, c: r.qrC, s: r.qrS },
      soliqUrl,
      taxData,
      taxDataSource,
    };
  }

  // ---------- large-receipt alerts (dashboard) ----------

  /** Not-yet-acknowledged receipts at/above `receipt.large_alert_amount` from the last 30 days. */
  async listLarge() {
    const threshold = await this.settings.get('receipt.large_alert_amount');
    const rows = await this.prisma.receipt.findMany({
      where: {
        amount: { gte: BigInt(threshold) },
        status: { not: 'rejected' },
        largeAckAt: null,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      include: { station: true, card: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      threshold,
      items: rows.map((r) => {
        const data = (r.taxData ?? null) as Record<string, unknown> | null;
        const extra = (data?.extraInfo ?? null) as Record<string, unknown> | null;
        const details = Array.isArray(data?.paymentDetails) ? (data!.paymentDetails as Record<string, unknown>[]) : [];
        return {
          id: r.id,
          amount: Number(r.amount),
          bonus: Number(r.bonus),
          status: r.status,
          receiptAt: r.receiptAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          stationName: r.station.name,
          clientName: r.card.user.firstName,
          clientPhone: r.card.user.phone,
          taxSource: r.taxSource,
          companyName: typeof extra?.companyName === 'string' ? extra.companyName : null,
          tin: data?.tin != null ? String(data.tin) : null,
          items: details.map((d) => ({
            name: String(d.productName ?? d.name ?? ''),
            quantity: Number(d.amount ?? 0),
            unit: d.packageName != null ? String(d.packageName) : null,
            price: Number(d.price ?? 0),
          })),
          soliqUrl: this.soliqLink(r),
        };
      }),
    };
  }

  async ackLarge(id: string, actorId: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new AppError('NOT_FOUND');
    await this.prisma.receipt.update({ where: { id }, data: { largeAckAt: new Date(), largeAckBy: actorId } });
    await this.audit.record({ actorId, action: 'receipt.ack_large', entityType: 'receipt', entityId: id, after: { amount: receipt.amount.toString() } });
    return { id };
  }

  async listPendingReview(cursor?: string, limit = 20) {
    const rows = await this.prisma.receipt.findMany({
      where: { status: 'pending_review' },
      include: { station: true, terminal: true, card: { include: { user: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async reviewDetail(id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { station: true, terminal: true, card: { include: { user: true } } } });
    if (!receipt) throw new AppError('NOT_FOUND');
    return receipt;
  }

  /**
   * Only reached for `tax_unverified` receipts — soliq.uz couldn't confirm the amount at
   * submit time. `amount` here is the reviewer's own reading of the fiscal-check link
   * (see `buildSoliqUrl`), since the receipt was created with amount=0/bonus=0.
   */
  async approve(id: string, reviewerId: string, note?: string, amount?: number) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new AppError('NOT_FOUND');
    if (receipt.status !== 'pending_review') return receipt;

    const finalAmount = amount !== undefined ? BigInt(amount) : receipt.amount;
    const finalBonus = amount !== undefined ? calcBonus(finalAmount, receipt.rateBps) : receipt.bonus;

    const result = await this.prisma.$transaction(async (tx) => {
      if (amount !== undefined) {
        await tx.receipt.update({ where: { id }, data: { amount: finalAmount, bonus: finalBonus } });
      }
      const posted = await this.ledger.post(tx, {
        cardId: receipt.cardId,
        delta: finalBonus,
        type: 'earn',
        refType: 'receipt',
        refId: receipt.id,
        actorId: reviewerId,
      });
      const updated = await tx.receipt.update({
        where: { id },
        data: { status: 'applied', reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note },
      });
      await this.notifications.enqueue(
        'client.receipt_applied',
        { cardId: receipt.cardId, receiptId: id, bonus: finalBonus.toString(), balanceAfter: posted.balanceAfter.toString() },
        tx,
      );
      return updated;
    });
    await this.audit.record({
      actorId: reviewerId,
      action: 'review.approve',
      entityType: 'receipt',
      entityId: id,
      after: { amount: finalAmount.toString(), bonus: finalBonus.toString(), note: note ?? null },
    });
    return result;
  }

  async reject(id: string, reviewerId: string, note: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new AppError('NOT_FOUND');
    if (receipt.status !== 'pending_review') return receipt;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.receipt.update({
        where: { id },
        data: { status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note },
      });
      await this.notifications.enqueue('client.receipt_rejected', { cardId: receipt.cardId, receiptId: id, note }, tx);
      return updated;
    });
    await this.audit.record({ actorId: reviewerId, action: 'review.reject', entityType: 'receipt', entityId: id, after: { note } });
    return result;
  }

  /** Receipts a reviewer already decided on (approved or rejected), newest decision first. */
  async listReviewed(scopeStationId: string | null, cursor?: string, limit = 30) {
    const rows = await this.prisma.receipt.findMany({
      where: { reviewedBy: { not: null }, reviewedAt: { not: null }, ...(scopeStationId ? { stationId: scopeStationId } : {}) },
      include: { station: true, terminal: true, card: { include: { user: true } } },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ids = [...new Set(page.map((r) => r.reviewedBy!))];
    const reviewers = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, phone: true } });
    const byId = new Map(reviewers.map((u) => [u.id, u]));
    return {
      items: page.map((r) => ({
        id: r.id,
        status: r.status,
        clientName: r.card.user.firstName,
        clientPhone: r.card.user.phone,
        stationName: r.station.name,
        terminalCode: r.terminal.code,
        receiptAt: r.receiptAt.toISOString(),
        amount: Number(r.amount),
        bonus: Number(r.bonus),
        reviewNote: r.reviewNote,
        reviewedAt: r.reviewedAt!.toISOString(),
        reviewerId: r.reviewedBy,
        reviewerName: byId.get(r.reviewedBy!)?.firstName ?? null,
        reviewerPhone: byId.get(r.reviewedBy!)?.phone ?? null,
        soliqLink: this.soliqLink(r),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  private async preCheck(parsed: ParsedReceiptQr): Promise<PreCheckResult> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { code: parsed.t },
      include: { station: true },
    });
    if (!terminal || !terminal.active) {
      throw new AppError('RECEIPT_TERMINAL_UNKNOWN');
    }

    const existing = await this.prisma.receipt.findUnique({
      where: { qrT_qrR_qrC: { qrT: parsed.t, qrR: parsed.r, qrC: parsed.c } },
    });
    if (existing) {
      throw new AppError('RECEIPT_ALREADY_USED', {
        usedAt: existing.createdAt.toISOString(),
      });
    }

    const receiptAt = parseReceiptTimestamp(parsed.c);
    const now = Date.now();
    if (receiptAt.getTime() - now > FUTURE_TOLERANCE_MS) {
      throw new AppError('RECEIPT_TIME_INVALID');
    }

    const maxAgeMin = await this.settings.get('receipt.max_age_min');
    if (now - receiptAt.getTime() > maxAgeMin * 60_000) {
      throw new AppError('RECEIPT_EXPIRED', { n: maxAgeMin });
    }

    return {
      parsed,
      receiptAt,
      terminal: { id: terminal.id, stationId: terminal.stationId, code: terminal.code, active: terminal.active },
      station: {
        id: terminal.station.id,
        name: terminal.station.name,
        lat: Number(terminal.station.lat),
        lng: Number(terminal.station.lng),
        radiusM: terminal.station.radiusM,
      },
    };
  }

}

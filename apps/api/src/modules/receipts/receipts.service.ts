import { Injectable, Logger } from '@nestjs/common';
import { AppError, type SubmitReceiptDto, type SubmitReceiptResponse } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { RateResolverService } from '@/modules/rules/rate-resolver.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { distanceMeters } from '@/common/lib/geo';
import { calcBonus } from '@/common/lib/money';
import { SoliqFetchService } from './soliq-fetch.service';
import { buildSoliqUrl, parseManualReceiptFields, parseReceiptQr, parseReceiptTimestamp, type ParsedReceiptQr } from './qr-parser';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

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

    // The client never supplies an amount or a photo — soliq.uz's fiscal-check page is the
    // sole source of truth for the receipt total. If it can't be confirmed right now (the
    // service is down, or the page didn't parse), the receipt waits for a reviewer to check
    // the link by hand and enter the real amount, instead of trusting anything client-side.
    const tax = await this.soliq.fetchAmount(parsed.url ?? buildSoliqUrl(parsed), parsed);
    const verified = tax.verified && tax.amount !== null;
    const amount = verified ? tax.amount! : 0n;
    const bonus = verified ? calcBonus(amount, rateBps) : 0n;
    const status = verified ? 'applied' : 'pending_review';
    const reviewReasons = verified ? [] : ['tax_unverified'];

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
        { cardId, receiptId: receipt.id, bonus: bonus.toString() },
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

  async listPendingReview(cursor?: string, limit = 20) {
    const rows = await this.prisma.receipt.findMany({
      where: { status: 'pending_review' },
      include: { station: true, card: { include: { user: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async reviewDetail(id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { station: true, card: { include: { user: true } } } });
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

    return this.prisma.$transaction(async (tx) => {
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
  }

  async reject(id: string, reviewerId: string, note: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new AppError('NOT_FOUND');
    if (receipt.status !== 'pending_review') return receipt;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.receipt.update({
        where: { id },
        data: { status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note },
      });
      await this.notifications.enqueue('client.receipt_rejected', { cardId: receipt.cardId, receiptId: id, note }, tx);
      return updated;
    });
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

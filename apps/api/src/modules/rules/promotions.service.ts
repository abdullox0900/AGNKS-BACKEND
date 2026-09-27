import { Injectable } from '@nestjs/common';
import { AppError, type PromotionStatus } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { BroadcastsService } from '@/modules/broadcasts/broadcasts.service';
import { SettingsService } from './settings.service';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly broadcasts: BroadcastsService,
  ) {}

  async list(status?: PromotionStatus) {
    const rows = await this.prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPromotionDto).filter((p) => !status || p.status === status);
  }

  async create(input: {
    name: string;
    rateBps: number;
    stationIds: string[] | null;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    createdBy: string;
    /** announce to clients at this time (bot + webapp feed); null = don't */
    notifyAt?: Date | null;
  }) {
    const maxRateBps = await this.settings.get('promotion.max_rate_bps');
    if (input.rateBps > maxRateBps) {
      throw new AppError('VALIDATION_ERROR', { message: `rateBps exceeds promotion.max_rate_bps (${maxRateBps})` });
    }

    const promo = await this.prisma.promotion.create({
      data: {
        name: input.name,
        rateBps: input.rateBps,
        stationIds: input.stationIds ?? [],
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
        createdBy: input.createdBy,
      },
    });

    await this.audit.record({
      actorId: input.createdBy,
      action: 'promotion.create',
      entityType: 'promotion',
      entityId: promo.id,
      after: promo,
    });

    if (input.notifyAt) {
      await this.broadcasts.createForPromotion(promo, input.notifyAt, input.createdBy);
    }

    return toPromotionDto(promo);
  }

  async cancel(id: string, actorId: string) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) throw new AppError('NOT_FOUND');

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { cancelledAt: new Date(), cancelledBy: actorId },
    });
    await this.broadcasts.cancelForPromotion(id);

    await this.audit.record({
      actorId,
      action: 'promotion.cancel',
      entityType: 'promotion',
      entityId: id,
      before: existing,
      after: updated,
    });

    return toPromotionDto(updated);
  }

  /** Rough projection: recent daily receipt volume at the affected stations × the rate delta. */
  async impactPreview(rateBps: number, stationIds: string[] | null) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const baseRateBps = await this.settings.get('bonus.base_rate_bps');

    const receipts = await this.prisma.receipt.findMany({
      where: {
        status: { not: 'rejected' },
        createdAt: { gte: since },
        ...(stationIds && stationIds.length > 0 ? { stationId: { in: stationIds } } : {}),
      },
      select: { amount: true },
    });

    const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0n);
    const avgDailyAmount = receipts.length > 0 ? totalAmount / 30n : 0n;
    const deltaBps = BigInt(rateBps - baseRateBps);
    const estimatedDailyExtraCost = (avgDailyAmount * deltaBps) / 10_000n;

    return {
      sampleDays: 30,
      sampleReceiptCount: receipts.length,
      avgDailyReceiptAmount: avgDailyAmount.toString(),
      estimatedDailyExtraCost: estimatedDailyExtraCost.toString(),
    };
  }
}

function toPromotionDto(promo: {
  id: string;
  name: string;
  rateBps: number;
  stationIds: string[];
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdBy: string;
  createdAt: Date;
  cancelledBy: string | null;
  cancelledAt: Date | null;
}) {
  const now = new Date();
  let status: PromotionStatus;
  if (promo.cancelledAt) status = 'cancelled';
  else if (now < promo.startsAt) status = 'scheduled';
  else if (now > promo.endsAt) status = 'ended';
  else status = 'active';

  return {
    id: promo.id,
    name: promo.name,
    rateBps: promo.rateBps,
    stationIds: promo.stationIds.length > 0 ? promo.stationIds : null,
    startsAt: promo.startsAt.toISOString(),
    endsAt: promo.endsAt.toISOString(),
    reason: promo.reason,
    status,
    createdBy: promo.createdBy,
    createdAt: promo.createdAt.toISOString(),
    cancelledBy: promo.cancelledBy,
    cancelledAt: promo.cancelledAt?.toISOString() ?? null,
  };
}

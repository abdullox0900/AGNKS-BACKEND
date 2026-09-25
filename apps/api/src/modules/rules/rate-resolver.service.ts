import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SettingsService } from './settings.service';

export interface ResolvedRate {
  rateBps: number;
  promotionId: string | null;
}

/**
 * TZ-4 §6.3 — resolved by receipt time (not scan time), most-specific wins:
 * 1) a promotion covering this exact station, 2) a network-wide promotion,
 * 3) the base rate. Ties within a tier go to whichever promotion was
 * created last, so a manager can always override by creating a new one.
 */
@Injectable()
export class RateResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async resolve(stationId: string, receiptAt: Date): Promise<ResolvedRate> {
    const stationPromo = await this.prisma.promotion.findFirst({
      where: {
        cancelledAt: null,
        startsAt: { lte: receiptAt },
        endsAt: { gte: receiptAt },
        stationIds: { has: stationId },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (stationPromo) {
      return { rateBps: stationPromo.rateBps, promotionId: stationPromo.id };
    }

    const networkPromo = await this.prisma.promotion.findFirst({
      where: {
        cancelledAt: null,
        startsAt: { lte: receiptAt },
        endsAt: { gte: receiptAt },
        stationIds: { isEmpty: true },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (networkPromo) {
      return { rateBps: networkPromo.rateBps, promotionId: networkPromo.id };
    }

    const baseRateBps = await this.settings.get('bonus.base_rate_bps');
    return { rateBps: baseRateBps, promotionId: null };
  }
}

import { RateResolverService } from '../rate-resolver.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { SettingsService } from '../settings.service';

function makePrismaMock(promotions: { stationPromo?: unknown; networkPromo?: unknown }) {
  return {
    promotion: {
      findFirst: jest
        .fn()
        // First call in resolve() looks for a station-specific promo.
        .mockImplementationOnce(async () => promotions.stationPromo ?? null)
        // Second call looks for a network-wide promo.
        .mockImplementationOnce(async () => promotions.networkPromo ?? null),
    },
  } as unknown as PrismaService;
}

function makeSettingsMock(baseRateBps: number) {
  return { get: jest.fn().mockResolvedValue(baseRateBps) } as unknown as SettingsService;
}

describe('RateResolverService', () => {
  const receiptAt = new Date('2026-09-22T10:00:00Z');

  it('prefers a station-specific promotion over everything else', async () => {
    const stationPromo = { id: 'promo-station', rateBps: 200 };
    const prisma = makePrismaMock({ stationPromo });
    const settings = makeSettingsMock(100);
    const service = new RateResolverService(prisma, settings);

    const result = await service.resolve('station-1', receiptAt);
    expect(result).toEqual({ rateBps: 200, promotionId: 'promo-station' });
  });

  it('falls back to a network-wide promotion when no station-specific one matches', async () => {
    const networkPromo = { id: 'promo-network', rateBps: 150 };
    const prisma = makePrismaMock({ networkPromo });
    const settings = makeSettingsMock(100);
    const service = new RateResolverService(prisma, settings);

    const result = await service.resolve('station-1', receiptAt);
    expect(result).toEqual({ rateBps: 150, promotionId: 'promo-network' });
  });

  it('falls back to the base rate when no promotion covers the receipt', async () => {
    const prisma = makePrismaMock({});
    const settings = makeSettingsMock(100);
    const service = new RateResolverService(prisma, settings);

    const result = await service.resolve('station-1', receiptAt);
    expect(result).toEqual({ rateBps: 100, promotionId: null });
  });
});

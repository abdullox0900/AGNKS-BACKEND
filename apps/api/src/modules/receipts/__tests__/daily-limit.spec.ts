import { ReceiptsService } from '../receipts.service';

function setup(o: { limit?: number; today?: number; blocked?: boolean } = {}) {
  const prisma = {
    card: { findUnique: jest.fn().mockResolvedValue({ blocked: o.blocked ?? false }) },
    receipt: { count: jest.fn().mockResolvedValue(o.today ?? 0), findUnique: jest.fn().mockResolvedValue(null) },
    terminal: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const settings = { get: jest.fn().mockImplementation(async (k: string) => (k === 'receipt.daily_limit' ? (o.limit ?? 3) : 0)) };
  const service = new ReceiptsService(prisma as never, {} as never, settings as never, {} as never, {} as never, {} as never, {} as never);
  return { service, prisma };
}

const dto = { qrText: 'https://ofd.soliq.uz/check?t=LG1&r=1&c=20261023101010&s=abc' };

describe('daily receipt limit', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T10:00:00Z')); // 15:00 in Tashkent
  });
  afterEach(() => jest.useRealTimers());

  it('refuses the 4th receipt of the day with the limit in the details', async () => {
    const { service } = setup({ today: 3 });
    await expect(service.submit('c1', dto as never)).rejects.toMatchObject({ code: 'RECEIPT_DAILY_LIMIT', details: { limit: 3 } });
  });

  it('counts from the start of the Tashkent day (00:00 = 19:00 UTC the evening before)', async () => {
    const { service, prisma } = setup({ today: 3 });
    await service.submit('c1', dto as never).catch(() => undefined);
    expect(prisma.receipt.count).toHaveBeenCalledWith({ where: { cardId: 'c1', createdAt: { gte: new Date('2026-10-22T19:00:00.000Z') } } });
  });

  it('under the limit it goes on to the normal checks (here: unknown terminal)', async () => {
    const { service } = setup({ today: 2 });
    await expect(service.submit('c1', dto as never)).rejects.toMatchObject({ code: 'RECEIPT_TERMINAL_UNKNOWN' });
  });

  it('limit 0 means no limit', async () => {
    const { service, prisma } = setup({ limit: 0, today: 99 });
    await expect(service.submit('c1', dto as never)).rejects.toMatchObject({ code: 'RECEIPT_TERMINAL_UNKNOWN' });
    expect(prisma.receipt.count).not.toHaveBeenCalled();
  });

  it('a blocked card is told it is blocked, not about the limit', async () => {
    const { service } = setup({ today: 9, blocked: true });
    await expect(service.submit('c1', dto as never)).rejects.toMatchObject({ code: 'CARD_BLOCKED' });
  });
});

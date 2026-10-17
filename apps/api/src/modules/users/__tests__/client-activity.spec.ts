import { AdminClientsService, FREQUENT_MIN_DAYS } from '../admin-clients.service';
import { resetClientActivityCache, tashkentDay, touchClientActivity } from '@/common/lib/client-activity';

describe('touchClientActivity', () => {
  beforeEach(() => resetClientActivityCache());
  const mk = () => ({
    user: { update: jest.fn().mockResolvedValue({}) },
    clientActivityDay: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  });

  it('counts days in Tashkent time (UTC+5), not UTC', () => {
    expect(tashkentDay(Date.parse('2026-10-17T20:00:00Z'))).toBe('2026-10-18');
    expect(tashkentDay(Date.parse('2026-10-17T18:59:00Z'))).toBe('2026-10-17');
  });

  it('writes the first visit of the day, then stays off the database for a few minutes', async () => {
    const prisma = mk();
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    await touchClientActivity(prisma as never, 'u1', t0);
    await touchClientActivity(prisma as never, 'u1', t0 + 60_000);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.clientActivityDay.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.clientActivityDay.createMany.mock.calls[0][0].data[0].day.toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });

  it('refreshes last seen later the same day without adding another day row', async () => {
    const prisma = mk();
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    await touchClientActivity(prisma as never, 'u1', t0);
    await touchClientActivity(prisma as never, 'u1', t0 + 10 * 60_000);
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.clientActivityDay.createMany).toHaveBeenCalledTimes(1);
  });

  it('a new day adds a new row; a database failure never throws', async () => {
    const prisma = mk();
    await touchClientActivity(prisma as never, 'u1', Date.parse('2026-10-17T10:00:00Z'));
    await touchClientActivity(prisma as never, 'u1', Date.parse('2026-10-18T10:00:00Z'));
    expect(prisma.clientActivityDay.createMany).toHaveBeenCalledTimes(2);
    prisma.user.update.mockRejectedValueOnce(new Error('db down'));
    await expect(touchClientActivity(prisma as never, 'u2', Date.now())).resolves.toBeUndefined();
  });
});

describe('AdminClientsService.page / stats', () => {
  function setup(over: { users?: unknown[]; frequent?: string[] } = {}) {
    const users = over.users ?? [
      { id: 'u1', firstName: 'Ali', phone: '+998901', registeredAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), lastSeenAt: new Date('2026-10-16'), card: { cachedBalance: 5000n, blocked: false } },
    ];
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(users.length), findMany: jest.fn().mockResolvedValue(users) },
      clientActivityDay: {
        groupBy: jest.fn().mockImplementation(async (args: { having?: unknown }) =>
          args.having ? (over.frequent ?? ['u1']).map((userId) => ({ userId })) : [{ userId: 'u1', _count: { _all: 7 } }],
        ),
      },
    };
    return { service: new AdminClientsService(prisma as never, {} as never, {} as never, {} as never), prisma };
  }

  it('returns 40 per page by default, newest balance first, with active days', async () => {
    const { service, prisma } = setup();
    const res = await service.page({});
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 40, orderBy: [{ card: { cachedBalance: 'desc' } }, { createdAt: 'desc' }] });
    expect(res).toMatchObject({ total: 1, page: 1, pageSize: 40, pages: 1 });
    expect(res.items[0]).toMatchObject({ id: 'u1', name: 'Ali', balance: 5000, activeDays: 7 });
  });

  it('page 3 skips 80; page size is capped', async () => {
    const { service, prisma } = setup();
    await service.page({ page: 3, pageSize: 40 });
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({ skip: 80, take: 40 });
    await service.page({ pageSize: 9999 });
    expect(prisma.user.findMany.mock.calls[1][0].take).toBe(100);
  });

  it('"recent" filters by last seen, "frequent" by the number of active days', async () => {
    const { service, prisma } = setup({ frequent: ['u1', 'u2'] });
    await service.page({ filter: 'recent' }, Date.parse('2026-10-17T10:00:00Z'));
    expect(prisma.user.count.mock.calls[0][0].where.lastSeenAt.gte.toISOString()).toBe('2026-10-10T10:00:00.000Z');
    await service.page({ filter: 'frequent' });
    expect(prisma.user.findMany.mock.calls[1][0].where.id).toEqual({ in: ['u1', 'u2'] });
    expect(prisma.clientActivityDay.groupBy.mock.calls.find((c) => c[0].having)![0].having).toEqual({ userId: { _count: { gte: FREQUENT_MIN_DAYS } } });
  });

  it('stats count everyone, those seen today, lately and often', async () => {
    const { service, prisma } = setup({ frequent: ['u1', 'u2', 'u3'] });
    prisma.user.count.mockResolvedValueOnce(120).mockResolvedValueOnce(9).mockResolvedValueOnce(40);
    expect(await service.stats()).toMatchObject({ total: 120, today: 9, recent: 40, frequent: 3, recentDays: 7, frequentMinDays: 5 });
  });
});

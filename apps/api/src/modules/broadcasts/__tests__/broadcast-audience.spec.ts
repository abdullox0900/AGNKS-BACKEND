import { BroadcastsService } from '../broadcasts.service';

function setup(over: { users?: { tgUserId: bigint; lang: string }[]; broadcasts?: unknown[]; receiptStations?: string[]; stationBotKeys?: string[]; botStations?: string[]; clientBot?: string | null } = {}) {
  const tx = { outbox: { createMany: jest.fn() }, broadcast: { update: jest.fn() } };
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(over.users ?? []), count: jest.fn().mockResolvedValue(7) },
    broadcast: {
      findMany: jest.fn().mockResolvedValue(over.broadcasts ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'b1', createdAt: new Date(), sentAt: null, cancelledAt: null, recipientCount: 0, status: 'scheduled', ...data })),
    },
    promotion: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', cancelledAt: null }) },
    station: { findMany: jest.fn().mockImplementation(async (a: { where?: { botKey?: unknown; id?: unknown } }) => (a?.where?.id ? (over.stationBotKeys ?? []).map((botKey) => ({ botKey })) : a?.where?.botKey ? (over.botStations ?? []).map((id) => ({ id })) : [{ name: 'Namuna' }])) },
    card: { findUnique: jest.fn().mockResolvedValue({ user: { botKey: over.clientBot ?? null } }) },
    receipt: { findMany: jest.fn().mockResolvedValue((over.receiptStations ?? []).map((stationId) => ({ stationId }))) },
    spendOperation: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new BroadcastsService(prisma as never, audit as never), prisma, tx };
}

const row = (o: Record<string, unknown>) => ({
  id: 'b1', textUz: 'uz', textRu: 'ru', sendAt: new Date('2026-10-18'), status: 'scheduled', promotionId: null, stationIds: [], recipientCount: 0, createdBy: 'u', createdAt: new Date(), sentAt: null, cancelledAt: null, ...o,
});

describe('who a broadcast reaches', () => {
  it('a manual announcement keeps going only to clients who switched promo messages on', async () => {
    const { service, prisma } = setup({ users: [{ tgUserId: 1n, lang: 'uz' }] });
    await service.dispatchDue();
    prisma.broadcast.findMany.mockResolvedValueOnce([row({})]);
    await service.dispatchDue();
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ consents: { some: { type: 'marketing', revokedAt: null } } });
    expect(where.AND).toHaveLength(1);
  });

  it('a promotion announcement reaches everyone who did not switch it OFF, limited to that station\'s clients', async () => {
    const { service, prisma } = setup({ users: [{ tgUserId: 5n, lang: 'ru' }] });
    prisma.broadcast.findMany.mockResolvedValueOnce([row({ promotionId: 'p1', stationIds: ['s1'] })]);
    await service.dispatchDue();
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([{ consents: { some: { type: 'marketing', revokedAt: null } } }, { consents: { none: { type: 'marketing' } } }]);
    expect(JSON.stringify(where.AND[1])).toContain('"stationId":{"in":["s1"]}');
    expect(JSON.stringify(where.AND[1])).toContain('"status":{"not":"rejected"}');
  });

  it('clients of the station\'s own Telegram bot are included too', async () => {
    const { service, prisma } = setup({ stationBotKeys: ['kokand'] });
    prisma.broadcast.findMany.mockResolvedValueOnce([row({ promotionId: 'p1', stationIds: ['s1'] })]);
    await service.dispatchDue();
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[1].OR).toHaveLength(2);
    expect(where.AND[1].OR[1]).toEqual({ botKey: { in: ['kokand'] } });
  });

  it('a promotion for the whole network is not limited to stations', async () => {
    const { service, prisma } = setup();
    prisma.broadcast.findMany.mockResolvedValueOnce([row({ promotionId: 'p1', stationIds: [] })]);
    await service.dispatchDue();
    expect(prisma.user.findMany.mock.calls[0][0].where.AND).toHaveLength(1);
  });

  it('the create form can preview the audience', async () => {
    const { service, prisma } = setup();
    expect(await service.promoAudienceCount(['s1'])).toBe(7);
    expect(JSON.stringify(prisma.user.count.mock.calls[0][0].where)).toContain('"in":["s1"]');
  });

  it('a promotion\'s announcement remembers which stations it is for', async () => {
    const { service, prisma } = setup();
    await service.createForPromotion({ id: 'p1', name: 'X', rateBps: 200, stationIds: ['s1'], startsAt: new Date(), endsAt: new Date() }, new Date(), 'u');
    expect(prisma.broadcast.create.mock.calls[0][0].data).toMatchObject({ promotionId: 'p1', stationIds: ['s1'] });
  });
});

describe('webapp news feed', () => {
  it('hides an offer meant for other stations, shows the client\'s own and network-wide ones', async () => {
    const mk = (id: string, stationIds: string[]) => row({ id, stationIds, status: 'sent', sentAt: new Date('2026-10-18') });
    const { service } = setup({ broadcasts: [mk('all', []), mk('mine', ['s1']), mk('other', ['s9'])], receiptStations: ['s1'] });
    const feed = await service.news('card1');
    expect(feed.map((f) => f.id)).toEqual(['all', 'mine']);
  });

  it('a client on the station\'s own bot sees its offer even before any receipt', async () => {
    const mk = (id: string, stationIds: string[]) => row({ id, stationIds, status: 'sent', sentAt: new Date('2026-10-18') });
    const { service } = setup({ broadcasts: [mk('mine', ['s1']), mk('other', ['s9'])], clientBot: 'kokand', botStations: ['s1'] });
    expect((await service.news('card1')).map((f) => f.id)).toEqual(['mine']);
  });
});

import { UsersService } from '../users.service';

const promo = (id: string, stationIds: string[]) => ({
  id, name: id, rateBps: 200, stationIds, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000), cancelledAt: null,
});

function setup(o: { promos: ReturnType<typeof promo>[]; botKey?: string | null; botStations?: string[]; receiptStations?: string[] }) {
  const prisma = {
    promotion: { findMany: jest.fn().mockResolvedValue(o.promos) },
    card: { findUnique: jest.fn().mockResolvedValue({ user: { botKey: o.botKey ?? null } }) },
    station: {
      findMany: jest.fn().mockImplementation(async (a: { where: { botKey?: string; id?: { in: string[] } } }) =>
        a.where.botKey ? (o.botStations ?? []).map((id) => ({ id })) : (a.where.id?.in ?? []).map((id) => ({ id, name: `Station ${id}` })),
      ),
    },
    receipt: { findMany: jest.fn().mockResolvedValue((o.receiptStations ?? []).map((stationId) => ({ stationId }))) },
    spendOperation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new UsersService(prisma as never, {} as never, {} as never);
}

describe('promotions a client sees', () => {
  it('network-wide offers are for everyone', async () => {
    const res = await setup({ promos: [promo('all', [])] }).promotions('c1');
    expect(res.map((p) => p.id)).toEqual(['all']);
  });

  it('an offer for one station is hidden from clients of other stations', async () => {
    const res = await setup({ promos: [promo('only-s1', ['s1'])], botKey: 'quva', botStations: ['s2'], receiptStations: ['s3'] }).promotions('c1');
    expect(res).toEqual([]);
  });

  it('shown to clients on that station\'s own bot, or who used that station', async () => {
    const byBot = await setup({ promos: [promo('p', ['s1'])], botKey: 'kokand', botStations: ['s1'] }).promotions('c1');
    expect(byBot.map((p) => p.id)).toEqual(['p']);
    expect(byBot[0].stations).toEqual(['Station s1']);
    const byReceipt = await setup({ promos: [promo('p', ['s1'])], receiptStations: ['s1'] }).promotions('c1');
    expect(byReceipt.map((p) => p.id)).toEqual(['p']);
  });
});

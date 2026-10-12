import { referralAnswerSchema, referralSettingsSchema, createAttendantSchema } from '@agnks/types';
import { ReferralsService } from '../referrals.service';

const UUID = '3f2c1b9e-8a4d-4c55-9d11-0a1b2c3d4e5f';

function setup(opts: { attendants?: any[]; referrals?: any[]; settings?: Record<string, unknown>; existing?: any; attendantRow?: any; registeredAt?: Date | null; withReferrals?: number } = {}) {
  const store: Record<string, unknown> = { 'referral.enabled': false, 'referral.enabled_from': '', 'referral.reward_amount': 1_500_000, ...(opts.settings ?? {}) };
  const settings = {
    get: jest.fn(async (k: string) => store[k]),
    set: jest.fn(async (k: string, v: unknown) => {
      store[k] = v;
    }),
  };
  const prisma = {
    attendant: {
      findMany: jest.fn().mockResolvedValue(opts.attendants ?? []),
      findUnique: jest.fn().mockResolvedValue(opts.attendantRow ?? null),
      create: jest.fn().mockResolvedValue({ id: 'a-new', name: 'Ali' }),
      update: jest.fn().mockResolvedValue({ id: 'a1', name: 'Ali', active: false }),
      delete: jest.fn().mockResolvedValue({}),
    },
    clientReferral: {
      findMany: jest.fn().mockResolvedValue(opts.referrals ?? []),
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ registeredAt: opts.registeredAt === undefined ? new Date() : opts.registeredAt }),
      count: jest.fn().mockResolvedValue(10),
    },
    station: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: 'Quva' }), findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new ReferralsService(prisma as never, settings as never, audit as never), prisma, settings, audit, store };
}

const att = (id: string, name: string, stationId = 's1', active = true) => ({ id, name, stationId, active, station: { name: 'Quva' } });
const SEO = { role: 'seo', stationId: null } as const;
const range = [new Date('2026-10-01'), new Date('2026-10-31')] as const;

describe('referral schemas', () => {
  it('an answer is exactly one of: attendant, typed name, skip', () => {
    expect(referralAnswerSchema.safeParse({ attendantId: UUID }).success).toBe(true);
    expect(referralAnswerSchema.safeParse({ name: 'Sardor aka' }).success).toBe(true);
    expect(referralAnswerSchema.safeParse({ skip: true }).success).toBe(true);
    expect(referralAnswerSchema.safeParse({}).success).toBe(false);
    expect(referralAnswerSchema.safeParse({ attendantId: UUID, name: 'Ali' }).success).toBe(false);
    expect(referralAnswerSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(referralAnswerSchema.safeParse({ skip: false }).success).toBe(false);
  });
  it('settings and attendants validate', () => {
    expect(referralSettingsSchema.safeParse({ enabled: true, rewardAmount: 1_500_000 }).success).toBe(true);
    expect(referralSettingsSchema.safeParse({}).success).toBe(false);
    expect(referralSettingsSchema.safeParse({ rewardAmount: -1 }).success).toBe(false);
    expect(createAttendantSchema.safeParse({ stationId: UUID, name: 'Ali' }).success).toBe(true);
    expect(createAttendantSchema.safeParse({ stationId: 'x', name: 'Ali' }).success).toBe(false);
  });
});

describe('ReferralsService.answer', () => {
  it('records a chosen attendant, a typed name, or a skip', async () => {
    const a = setup({ attendantRow: { active: true } });
    await a.service.answer('u1', { attendantId: UUID });
    expect(a.prisma.clientReferral.create).toHaveBeenCalledWith({ data: { userId: 'u1', attendantId: UUID } });
    const b = setup();
    await b.service.answer('u1', { name: 'Sardor' });
    expect(b.prisma.clientReferral.create).toHaveBeenCalledWith({ data: { userId: 'u1', typedName: 'Sardor' } });
    const c = setup();
    await c.service.answer('u1', { skip: true });
    expect(c.prisma.clientReferral.create).toHaveBeenCalledWith({ data: { userId: 'u1', skipped: true } });
  });

  it('never overwrites an earlier answer', async () => {
    const { service, prisma } = setup({ existing: { userId: 'u1' } });
    await expect(service.answer('u1', { name: 'Boshqa' })).resolves.toEqual({ ok: true });
    expect(prisma.clientReferral.create).not.toHaveBeenCalled();
  });

  it('refuses an attendant who is switched off or unknown, and a client who has not registered', async () => {
    await expect(setup({ attendantRow: { active: false } }).service.answer('u1', { attendantId: UUID })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(setup({ attendantRow: null }).service.answer('u1', { attendantId: UUID })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(setup({ registeredAt: null }).service.answer('u1', { skip: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ReferralsService.summary', () => {
  it('ranks attendants, credits an unambiguous typed name to the matching attendant and lists the rest', async () => {
    const { service } = setup({
      attendants: [att('a1', 'Sardor Aliyev'), att('a2', 'Bekzod'), att('a3', 'Nodir'), att('a4', 'Eski hodim', 's1', false)],
      referrals: [
        { attendantId: 'a1', typedName: null, skipped: false },
        { attendantId: 'a1', typedName: null, skipped: false },
        { attendantId: null, typedName: '  sardor   ALIYEV ', skipped: false }, // → a1
        { attendantId: 'a2', typedName: null, skipped: false },
        { attendantId: null, typedName: 'Notanish Odam', skipped: false },
        { attendantId: null, typedName: 'notanish odam', skipped: false },
        { attendantId: null, typedName: null, skipped: true },
      ],
    });
    const res = await service.summary(SEO as never, ...range);
    expect(res.ranking.map((r) => [r.name, r.clients, r.typed])).toEqual([
      ['Sardor Aliyev', 3, 1],
      ['Bekzod', 1, 0],
      ['Nodir', 0, 0],
    ]); // the switched-off attendant with no clients is hidden
    expect(res.unmatched).toEqual([{ name: 'Notanish Odam', count: 2 }]);
    expect(res).toMatchObject({ newClients: 10, skipped: 1, answered: 6, rewardAmount: 1_500_000, enabled: false });
  });

  it('does not guess when two attendants share a name', async () => {
    const { service } = setup({
      attendants: [att('a1', 'Ali'), att('a2', 'ali', 's2')],
      referrals: [{ attendantId: null, typedName: 'Ali', skipped: false }],
    });
    const res = await service.summary(SEO as never, ...range);
    expect(res.ranking.every((r) => r.clients === 0)).toBe(true);
    expect(res.unmatched).toEqual([{ name: 'Ali', count: 1 }]);
  });

  it('a branch manager only sees their own station', async () => {
    const { service, prisma } = setup();
    await service.summary({ role: 'branch_manager', stationId: 's9' } as never, ...range);
    expect(prisma.attendant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stationId: { in: ['s9'] } } }));
  });
});

describe('ReferralsService attendants and settings', () => {
  it('removing someone who already brought clients only switches them off', async () => {
    const { service, prisma, audit } = setup({ attendantRow: { id: 'a1', name: 'Ali', _count: { referrals: 4 } } });
    expect(await service.removeAttendant('a1', 'u1')).toEqual({ id: 'a1', deactivated: true });
    expect(prisma.attendant.delete).not.toHaveBeenCalled();
    expect(prisma.attendant.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { active: false } });
    expect(audit.record).toHaveBeenCalled();
  });

  it('removes someone with no clients for good', async () => {
    const { service, prisma } = setup({ attendantRow: { id: 'a1', name: 'Ali', _count: { referrals: 0 } } });
    expect(await service.removeAttendant('a1', 'u1')).toEqual({ id: 'a1', deactivated: false });
    expect(prisma.attendant.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('switching the question on stamps the moment, so older clients are not asked; switching off or changing the reward does not', async () => {
    const { service, store } = setup();
    await service.updateSettings({ enabled: true }, 'u1');
    expect(store['referral.enabled']).toBe(true);
    expect(typeof store['referral.enabled_from']).toBe('string');
    expect(new Date(store['referral.enabled_from'] as string).getTime()).toBeGreaterThan(Date.now() - 5000);
    const stamp = store['referral.enabled_from'];
    await service.updateSettings({ rewardAmount: 2_000_000 }, 'u1');
    expect(store['referral.reward_amount']).toBe(2_000_000);
    expect(store['referral.enabled_from']).toBe(stamp);
    await service.updateSettings({ enabled: false }, 'u1');
    expect(store['referral.enabled']).toBe(false);
    expect(store['referral.enabled_from']).toBe(stamp);
  });
});

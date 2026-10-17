import { AutoReviewService } from '../auto-review.service';

const record = (over: Record<string, unknown> = {}) => ({
  terminalId: 'LG1',
  paymentNo: 77,
  paymentDate: '25.09.2026 17:07:21',
  cashTotal: 0,
  cardTotal: 200_000,
  isRefund: 0,
  ...over,
});

const waiting = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  cardId: 'c1',
  qrT: 'LG1',
  qrR: '77',
  qrC: '20260925170721',
  qrS: '012',
  rateBps: 100,
  reviewReasons: ['tax_unverified'],
  status: 'pending_review',
  createdAt: new Date(Date.now() - 60 * 60_000),
  autoCheckedAt: null as Date | null,
  ...over,
});

function setup(opts: { enabled?: boolean; delayMin?: number; rows?: unknown[]; found?: unknown; claimed?: number; fetch?: unknown } = {}) {
  const tx = {
    receipt: { updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }) },
  };
  const prisma = {
    receipt: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
      findUnique: jest.fn().mockResolvedValue(opts.found ?? waiting()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const ledger = { post: jest.fn().mockResolvedValue({ balanceAfter: 2000n, entryId: 'e1' }) };
  const settings = {
    get: jest.fn().mockImplementation(async (k: string) => (k === 'receipt.auto_review' ? opts.enabled ?? true : opts.delayMin ?? 10)),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const soliq = {
    fetchAmount: jest.fn().mockResolvedValue(opts.fetch ?? { verified: false, amount: null, data: null, reason: 'tax_unverified' }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AutoReviewService(prisma as never, ledger as never, settings as never, notifications as never, soliq as never, audit as never);
  return { service, prisma, tx, ledger, settings, notifications, soliq, audit };
}

describe('AutoReviewService', () => {
  it('does nothing while the switch is off', async () => {
    const { service, prisma, soliq } = setup({ enabled: false });
    expect(await service.runDue()).toEqual({ checked: 0, approved: 0 });
    expect(prisma.receipt.findMany).not.toHaveBeenCalled();
    expect(soliq.fetchAmount).not.toHaveBeenCalled();
  });

  it('only picks receipts that waited long enough, never refunds, and only those the server may still retry', async () => {
    const { service, prisma } = setup({ rows: [] });
    await service.runDue();
    const where = prisma.receipt.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('pending_review');
    expect(where.NOT).toEqual({ reviewReasons: { has: 'tax_refund' } });
    expect(where.autoAttempts).toEqual({ lt: 6 });
    expect(where.AND[0].OR).toHaveLength(2);
  });

  it('credits the bonus itself when soliq.uz now confirms the receipt, and leaves a trace', async () => {
    const { service, tx, ledger, notifications, audit } = setup({
      rows: [waiting()],
      fetch: { verified: true, amount: 200_000n, data: record() },
    });
    expect(await service.runDue()).toEqual({ checked: 1, approved: 1 });
    expect(tx.receipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: 'pending_review' },
        data: expect.objectContaining({ status: 'applied', amount: 200_000n, bonus: 2000n, autoReviewed: true, taxSource: 'server' }),
      }),
    );
    expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({ cardId: 'c1', delta: 2000n, type: 'earn', actorId: null }));
    expect(notifications.enqueue).toHaveBeenCalledWith('client.receipt_applied', expect.objectContaining({ bonus: '2000' }), tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'review.auto_approve', actorId: null }));
  });

  it('if a person decided first, nothing is credited twice', async () => {
    const { service, ledger, audit } = setup({ rows: [waiting()], fetch: { verified: true, amount: 200_000n, data: record() }, claimed: 0 });
    expect(await service.runDue()).toEqual({ checked: 1, approved: 0 });
    expect(ledger.post).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a failed try is counted and the receipt stays for a person', async () => {
    const { service, prisma, ledger } = setup({ rows: [waiting()] });
    expect(await service.runDue()).toEqual({ checked: 1, approved: 0 });
    expect(ledger.post).not.toHaveBeenCalled();
    expect(prisma.receipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ autoAttempts: { increment: 1 } }) }),
    );
  });

  it('phone re-check: accepts a record that matches the receipt QR', async () => {
    const { service, tx, ledger } = setup({ found: waiting() });
    const res = await service.recheckFromPhone('c1', 'r1', record());
    expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({ delta: 2000n }));
    expect(tx.receipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ taxSource: 'client', autoReviewed: true }) }));
    expect(res.status).toBeDefined();
  });

  it('phone re-check: rejects a record of another receipt, someone else\'s receipt, a too-fresh one, and anything while off', async () => {
    const mismatch = setup({ found: waiting() });
    await mismatch.service.recheckFromPhone('c1', 'r1', record({ paymentNo: 5 }));
    expect(mismatch.ledger.post).not.toHaveBeenCalled();

    await expect(setup({ found: waiting({ cardId: 'other' }) }).service.recheckFromPhone('c1', 'r1', record())).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const fresh = setup({ found: waiting({ createdAt: new Date() }) });
    await fresh.service.recheckFromPhone('c1', 'r1', record());
    expect(fresh.ledger.post).not.toHaveBeenCalled();

    await expect(setup({ enabled: false }).service.recheckFromPhone('c1', 'r1', record())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('phone list is empty while the switch is off and respects the delay otherwise', async () => {
    expect(await setup({ enabled: false }).service.listForPhone('c1')).toEqual({ items: [] });
    const on = setup({ rows: [waiting()] });
    const res = await on.service.listForPhone('c1');
    expect(res.items).toEqual([{ id: 'r1', t: 'LG1', r: '77', c: '20260925170721', s: '012' }]);
    expect(on.prisma.receipt.findMany.mock.calls[0][0].where.cardId).toBe('c1');
  });

  it('saves the switch and the delay, each as its own setting', async () => {
    const { service, settings } = setup();
    await service.updateSettings({ enabled: true, delayMin: 30 }, 'seo1');
    expect(settings.set).toHaveBeenCalledWith('receipt.auto_review_delay_min', 30, 'seo1');
    expect(settings.set).toHaveBeenCalledWith('receipt.auto_review', true, 'seo1');
  });
});

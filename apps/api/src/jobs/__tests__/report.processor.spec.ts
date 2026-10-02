import { ReportDailyProcessor } from '../report.processor';

describe('ReportDailyProcessor — evening summary per cashier', () => {
  it('queues one message per cashier that redeemed something and has a linked Telegram', async () => {
    const enqueue = jest.fn();
    const queryRaw = jest.fn().mockResolvedValue([
      { tg: 111n, amount: 125000n, count: 4n },
      { tg: 222n, amount: 8000n, count: 1n },
    ]);
    await new ReportDailyProcessor({ $queryRaw: queryRaw } as never, { enqueue } as never).process();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith('staff.cashier_daily', { tgUserId: 111, amount: '125000', count: 4 });
    expect(enqueue).toHaveBeenCalledWith('staff.cashier_daily', { tgUserId: 222, amount: '8000', count: 1 });
  });

  it('sends nothing when nobody redeemed anything today', async () => {
    const enqueue = jest.fn();
    await new ReportDailyProcessor({ $queryRaw: jest.fn().mockResolvedValue([]) } as never, { enqueue } as never).process();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

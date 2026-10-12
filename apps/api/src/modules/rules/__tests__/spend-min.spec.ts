import { setSpendMinSchema } from '@agnks/types';
import { RulesController } from '../rules.controller';

function setup(max = 500_000) {
  const store: Record<string, number> = { 'spend.min_amount': 5000, 'spend.max_amount': max, 'bonus.base_rate_bps': 100, 'methane.price': 3900 };
  const settings = {
    get: jest.fn(async (k: string) => store[k]),
    set: jest.fn(async (k: string, v: number) => {
      store[k] = v;
    }),
  };
  const controller = new RulesController(settings as never, {} as never);
  return { controller, settings, store };
}
const actor = { userId: 'u1' } as never;

describe('minimum redeem amount (Dashboard → clients)', () => {
  it('is returned with the bonus settings, together with the maximum', async () => {
    const { controller } = setup();
    expect(await controller.getBonusSettings()).toMatchObject({ spendMinAmount: 5000, spendMaxAmount: 500_000 });
  });

  it('saves a new minimum and the clients/cashier read it back from the same setting', async () => {
    const { controller, settings, store } = setup();
    expect(await controller.setSpendMin({ amount: 20_000 }, actor)).toEqual({ spendMinAmount: 20_000, spendMaxAmount: 500_000 });
    expect(settings.set).toHaveBeenCalledWith('spend.min_amount', 20_000, 'u1');
    expect(store['spend.min_amount']).toBe(20_000);
  });

  it('refuses a minimum above the maximum a client may redeem', async () => {
    const { controller, settings } = setup(100_000);
    await expect(controller.setSpendMin({ amount: 100_001 }, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(settings.set).not.toHaveBeenCalled();
    await expect(controller.setSpendMin({ amount: 100_000 }, actor)).resolves.toBeTruthy();
  });

  it('only accepts whole positive amounts', () => {
    expect(setSpendMinSchema.safeParse({ amount: 1 }).success).toBe(true);
    expect(setSpendMinSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(setSpendMinSchema.safeParse({ amount: -5 }).success).toBe(false);
    expect(setSpendMinSchema.safeParse({ amount: 1500.5 }).success).toBe(false);
    expect(setSpendMinSchema.safeParse({ amount: '5000' }).success).toBe(false);
  });
});

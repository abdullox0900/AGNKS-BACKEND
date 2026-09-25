import { calcBonus } from '../money';

describe('calcBonus', () => {
  it('computes floor(amount * bps / 10000)', () => {
    expect(calcBonus(387_000n, 100)).toBe(3_870n); // 1%
    expect(calcBonus(214_000n, 100)).toBe(2_140n);
    expect(calcBonus(100_000n, 200)).toBe(2_000n); // 2%
  });

  it('floors instead of rounding', () => {
    // 99 * 100 / 10000 = 0.99 -> floor to 0
    expect(calcBonus(99n, 100)).toBe(0n);
  });

  it('supports 0 bps (bonus disabled for this receipt)', () => {
    expect(calcBonus(500_000n, 0)).toBe(0n);
  });

  it('accepts a plain number amount', () => {
    expect(calcBonus(387_000, 100)).toBe(3_870n);
  });
});

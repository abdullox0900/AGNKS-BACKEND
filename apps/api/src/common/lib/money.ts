/** bonus = floor(amount * bps / 10000). Integer-only — no floats touch money. */
export function calcBonus(amount: bigint | number, rateBps: number): bigint {
  const amt = typeof amount === 'bigint' ? amount : BigInt(Math.trunc(amount));
  return (amt * BigInt(rateBps)) / 10_000n;
}

export function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

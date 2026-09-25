export function formatMoney(value: unknown): string {
  const n = typeof value === 'bigint' ? value : BigInt(String(value ?? '0'));
  return `${n.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`;
}

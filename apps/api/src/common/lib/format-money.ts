export type MessageLang = 'uz' | 'ru';

export function formatMoney(value: unknown, lang: MessageLang = 'uz'): string {
  const n = typeof value === 'bigint' ? value : BigInt(String(value ?? '0'));
  return `${n.toLocaleString('ru-RU').replace(/,/g, ' ')} ${lang === 'ru' ? 'сум' : "so'm"}`;
}

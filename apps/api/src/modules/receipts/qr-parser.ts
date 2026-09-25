import { AppError } from '@agnks/types';

export interface ParsedReceiptQr {
  t: string;
  r: string;
  c: string;
  s: string;
  url: string;
}

const ALLOWED_HOSTS = new Set(['ofd.soliq.uz', 'www.ofd.soliq.uz']);

/**
 * Parses the fiscal-check QR payload (TZ-4 §6.1):
 *   https://ofd.soliq.uz/check?t=<terminal>&r=<receipt_no>&c=<YYYYMMDDHHmmss>&s=<signature>
 * Text parsing only — this module makes no network calls itself.
 */
export function parseReceiptQr(qrText: string): ParsedReceiptQr {
  let url: URL;
  try {
    url = new URL(qrText.trim());
  } catch {
    throw new AppError('RECEIPT_QR_INVALID');
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new AppError('RECEIPT_QR_INVALID');
  }

  const t = url.searchParams.get('t');
  const r = url.searchParams.get('r');
  const c = url.searchParams.get('c');
  const s = url.searchParams.get('s');

  if (!t || !r || !c || !s) {
    throw new AppError('RECEIPT_QR_INVALID');
  }
  if (!/^\d{14}$/.test(c)) {
    throw new AppError('RECEIPT_QR_INVALID');
  }

  return { t, r, c, s, url: url.toString() };
}

export function parseManualReceiptFields(fields: { t: string; r: string; c: string; s: string }): ParsedReceiptQr {
  if (!fields.t || !fields.r || !fields.s || !/^\d{14}$/.test(fields.c)) {
    throw new AppError('RECEIPT_QR_INVALID');
  }
  return { ...fields, url: buildSoliqUrl(fields) };
}

export function buildSoliqUrl(fields: { t: string; r: string; c: string; s: string }): string {
  const url = new URL('https://ofd.soliq.uz/check');
  url.searchParams.set('t', fields.t);
  url.searchParams.set('r', fields.r);
  url.searchParams.set('c', fields.c);
  url.searchParams.set('s', fields.s);
  return url.toString();
}

/** `c` is `Asia/Tashkent` local time in `YYYYMMDDHHmmss`, converted to a UTC instant. */
export function parseReceiptTimestamp(c: string): Date {
  const year = Number(c.slice(0, 4));
  const month = Number(c.slice(4, 6));
  const day = Number(c.slice(6, 8));
  const hour = Number(c.slice(8, 10));
  const minute = Number(c.slice(10, 12));
  const second = Number(c.slice(12, 14));

  // Asia/Tashkent is UTC+5 year-round (no DST) — a fixed offset is safe.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - 5 * 60 * 60 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('RECEIPT_QR_INVALID');
  }
  return date;
}

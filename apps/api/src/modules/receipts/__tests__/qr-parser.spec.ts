import { AppError } from '@agnks/types';
import { parseReceiptQr, parseManualReceiptFields, parseReceiptTimestamp, buildSoliqUrl } from '../qr-parser';

describe('parseReceiptQr', () => {
  const VALID = 'https://ofd.soliq.uz/check?t=TERM1&r=000123&c=20260922143000&s=SIGXYZ';

  it('parses a valid fiscal-check URL', () => {
    const result = parseReceiptQr(VALID);
    expect(result).toEqual({
      t: 'TERM1',
      r: '000123',
      c: '20260922143000',
      s: 'SIGXYZ',
      url: VALID,
    });
  });

  it('rejects a non-URL string', () => {
    expect(() => parseReceiptQr('not a url at all')).toThrow(AppError);
  });

  it('rejects a URL on a disallowed host', () => {
    expect(() => parseReceiptQr('https://evil.example.com/check?t=1&r=2&c=20260922143000&s=3')).toThrow(AppError);
  });

  it('rejects a URL missing a required parameter', () => {
    expect(() => parseReceiptQr('https://ofd.soliq.uz/check?t=TERM1&r=000123&c=20260922143000')).toThrow(AppError);
  });

  it('rejects a malformed timestamp', () => {
    expect(() => parseReceiptQr('https://ofd.soliq.uz/check?t=T&r=R&c=not-a-date&s=S')).toThrow(AppError);
  });

  it('throws with RECEIPT_QR_INVALID code', () => {
    try {
      parseReceiptQr('garbage');
      fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('RECEIPT_QR_INVALID');
    }
  });
});

describe('parseManualReceiptFields', () => {
  it('accepts well-formed manual fields', () => {
    const result = parseManualReceiptFields({ t: 'T1', r: 'R1', c: '20260922143000', s: 'S1' });
    expect(result.t).toBe('T1');
    expect(result.url).toBe(buildSoliqUrl({ t: 'T1', r: 'R1', c: '20260922143000', s: 'S1' }));
  });

  it('rejects an invalid timestamp format', () => {
    expect(() => parseManualReceiptFields({ t: 'T1', r: 'R1', c: '2026-09-22', s: 'S1' })).toThrow(AppError);
  });

  it('rejects empty fields', () => {
    expect(() => parseManualReceiptFields({ t: '', r: 'R1', c: '20260922143000', s: 'S1' })).toThrow(AppError);
  });
});

describe('parseReceiptTimestamp', () => {
  it('converts Asia/Tashkent local time (UTC+5) to the correct UTC instant', () => {
    // 2026-09-22 14:30:00 in Tashkent (UTC+5) is 09:30:00 UTC.
    const date = parseReceiptTimestamp('20260922143000');
    expect(date.toISOString()).toBe('2026-09-22T09:30:00.000Z');
  });

  it('handles midnight correctly across the day boundary', () => {
    // 2026-01-01 02:00:00 Tashkent -> 2025-12-31 21:00:00 UTC.
    const date = parseReceiptTimestamp('20260101020000');
    expect(date.toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });
});

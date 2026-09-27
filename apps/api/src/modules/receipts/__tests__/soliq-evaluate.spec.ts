import { evaluateSoliqData } from '../soliq-fetch.service';
import type { ParsedReceiptQr } from '../qr-parser';

// Shape of a real new-ofd.soliq.uz/api/payment `data` record (trimmed).
const record = () => ({
  terminalId: 'LG420230610657',
  paymentNo: 119376,
  paymentDate: '25.09.2026 17:07:21',
  cashTotal: 0,
  cardTotal: 1000,
  isRefund: 0,
  tin: 312164897,
  paymentDetails: [{ productName: 'Metan gaz', price: 1000, amount: 0.179, packageName: 'куб. метр' }],
  extraInfo: { companyName: '"SULTAN METAN 7" MCHJ' },
});

const qr: ParsedReceiptQr = { t: 'LG420230610657', r: '119376', c: '20260925170721', s: '012', url: '' };

describe('evaluateSoliqData', () => {
  it('accepts a record matching the QR and sums cash + card', () => {
    const res = evaluateSoliqData({ ...record(), cashTotal: 500 }, qr);
    expect(res.verified).toBe(true);
    expect(res.amount).toBe(1500n);
    expect(res.data?.tin).toBe(312164897);
  });

  it('rejects a record for another terminal, number or date', () => {
    expect(evaluateSoliqData({ ...record(), terminalId: 'OTHER' }, qr).reason).toBe('tax_mismatch');
    expect(evaluateSoliqData({ ...record(), paymentNo: 1 }, qr).reason).toBe('tax_mismatch');
    expect(evaluateSoliqData({ ...record(), paymentDate: '26.09.2026 17:07:21' }, qr).reason).toBe('tax_mismatch');
  });

  it('never pays out on a refund receipt', () => {
    const res = evaluateSoliqData({ ...record(), isRefund: 1 }, qr);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe('tax_refund');
  });

  it('rejects negative or non-numeric totals', () => {
    expect(evaluateSoliqData({ ...record(), cardTotal: -5 }, qr).verified).toBe(false);
    expect(evaluateSoliqData({ ...record(), cardTotal: 'abc' }, qr).verified).toBe(false);
  });
});

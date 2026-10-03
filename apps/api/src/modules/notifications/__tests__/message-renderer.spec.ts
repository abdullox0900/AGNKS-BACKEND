import { isHtmlMessage, renderMessage } from '../message-renderer';

const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s/g, ' ');

describe('renderMessage — title, body, language', () => {
  it('bonus credited: Uzbek and Russian, bold title first, amount and balance', () => {
    const p = { bonus: '733', balanceAfter: '41483' };
    const uz = renderMessage('client.receipt_applied', p, 'uz');
    const ru = renderMessage('client.receipt_applied', p, 'ru');
    expect(uz.split('\n')[0]).toBe('<b>✅ Bonus tushdi</b>');
    expect(plain(uz)).toContain("+733 so'm");
    expect(plain(uz)).toContain("Balans: 41 483 so'm");
    expect(ru.split('\n')[0]).toBe('<b>✅ Бонус начислен</b>');
    expect(plain(ru)).toContain('+733 сум');
    expect(plain(ru)).toContain('Баланс: 41 483 сум');
  });

  it('defaults to Uzbek and leaves the balance line out when it is unknown', () => {
    const text = renderMessage('client.receipt_applied', { bonus: '100' });
    expect(text.split('\n')[0]).toBe('<b>✅ Bonus tushdi</b>');
    expect(text).not.toContain('💰');
  });

  it('bonus redeemed shows the amount with a minus and the remaining balance', () => {
    const uz = plain(renderMessage('client.spend_applied', { amount: '10000', balanceAfter: '41483' }, 'uz'));
    expect(uz).toContain('💳 Bonus yechildi');
    expect(uz).toContain("−10 000 so'm");
    expect(uz).toContain("41 483 so'm");
    expect(plain(renderMessage('client.spend_applied', { amount: '10000' }, 'ru'))).toContain('Бонус списан');
  });

  it('escapes anything a person or a cashier typed (rejection reason)', () => {
    const text = renderMessage('client.receipt_rejected', { note: '<b>x</b> & y' }, 'ru');
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(text).not.toContain('<b>x</b>');
  });

  it('every client notification has a Russian version', () => {
    const kinds = ['client.receipt_applied', 'client.receipt_pending', 'client.receipt_rejected', 'client.spend_applied', 'client.dispute_resolved', 'client.bonus_expiry_warning', 'client.bonus_expired'] as const;
    for (const k of kinds) {
      const ru = renderMessage(k, { bonus: '1', amount: '1', days: 3, resolution: 'upheld' }, 'ru');
      expect(ru).toMatch(/[А-Яа-я]/);
      expect(ru).not.toMatch(/so'm|tushdi|yechildi/);
    }
  });

  it('broadcasts are sent exactly as written, as plain text', () => {
    expect(renderMessage('client.broadcast', { text: '🔥 <Aksiya> & more' }, 'ru')).toBe('🔥 <Aksiya> & more');
    expect(isHtmlMessage('client.broadcast')).toBe(false);
    expect(isHtmlMessage('client.spend_applied')).toBe(true);
  });
});

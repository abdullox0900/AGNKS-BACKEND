import { NotificationsService } from '../notifications.service';
import { renderMessage } from '../message-renderer';

describe('the staff bot is silent except for the cashier daily summary', () => {
  const create = jest.fn();
  const svc = new NotificationsService({ outbox: { create } } as never);
  beforeEach(() => create.mockClear());

  it.each(['staff.anomaly', 'staff.shift_forgotten', 'staff.shift_flagged', 'staff.daily_report'] as const)('%s is no longer queued', async (kind) => {
    await svc.enqueue(kind, { reason: 'x' });
    expect(create).not.toHaveBeenCalled();
  });

  it('the cashier summary is queued', async () => {
    await svc.enqueue('staff.cashier_daily', { tgUserId: 1, amount: '5000', count: 2 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('client notifications are untouched', async () => {
    await svc.enqueue('client.broadcast', { text: 'hi' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('the summary text names the amount and the number of operations', () => {
    const text = renderMessage('staff.cashier_daily', { amount: '125000', count: 4 }).replace(/\s/g, ' '); // ru-RU groups with a non-breaking space
    expect(text).toContain('4 ta operatsiya');
    expect(text).toContain('125 000');
  });
});

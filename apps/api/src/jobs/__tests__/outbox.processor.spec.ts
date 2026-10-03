import { OutboxProcessor } from '../outbox.processor';

function setup(users: { tgUserId: bigint; lang: 'uz' | 'ru' }[], recipients: number[]) {
  const update = jest.fn();
  const sendMessage = jest.fn().mockResolvedValue({});
  const prisma = {
    outbox: { update },
    user: { findMany: jest.fn().mockResolvedValue(users) },
  };
  const bot = { api: { sendMessage } };
  const proc = new OutboxProcessor(prisma as never, bot as never, null as never);
  const row = { id: 'o1', kind: 'client.spend_applied', payload: { amount: '5000', balanceAfter: '31583', tgUserId: recipients[0] }, attempts: 0 };
  return { proc, update, sendMessage, row };
}

describe('OutboxProcessor — language and format', () => {
  it('sends a Russian-speaking client the Russian text, as HTML', async () => {
    const { proc, sendMessage, row, update } = setup([{ tgUserId: 7n, lang: 'ru' }], [7]);
    await (proc as never as { dispatchOne: (r: unknown) => Promise<void> }).dispatchOne(row);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text, opts] = sendMessage.mock.calls[0];
    expect(chat).toBe(7);
    expect(text).toContain('Бонус списан');
    expect(opts).toEqual({ parse_mode: 'HTML' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'sent' } });
  });

  it('sends an Uzbek client the Uzbek text, and Uzbek when the language is unknown', async () => {
    const { proc, sendMessage, row } = setup([{ tgUserId: 7n, lang: 'uz' }], [7]);
    await (proc as never as { dispatchOne: (r: unknown) => Promise<void> }).dispatchOne(row);
    expect(sendMessage.mock.calls[0][1]).toContain('Bonus yechildi');

    const unknown = setup([], [8]);
    await (unknown.proc as never as { dispatchOne: (r: unknown) => Promise<void> }).dispatchOne(unknown.row);
    expect(unknown.sendMessage.mock.calls[0][1]).toContain('Bonus yechildi');
  });

  it('broadcasts go out as plain text without parse_mode', async () => {
    const { proc, sendMessage } = setup([{ tgUserId: 7n, lang: 'ru' }], [7]);
    await (proc as never as { dispatchOne: (r: unknown) => Promise<void> }).dispatchOne({ id: 'b1', kind: 'client.broadcast', payload: { tgUserId: 7, text: 'Yangi <aksiya>' }, attempts: 0 });
    expect(sendMessage.mock.calls[0][1]).toBe('Yangi <aksiya>');
    expect(sendMessage.mock.calls[0][2]).toBeUndefined();
  });
});

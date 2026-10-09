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

describe('OutboxProcessor — one bot per station', () => {
  function multi(users: { tgUserId: bigint; lang: 'uz' | 'ru'; botKey: string | null }[]) {
    const update = jest.fn();
    const main = jest.fn().mockResolvedValue({});
    const quva = jest.fn().mockResolvedValue({});
    const prisma = { outbox: { update }, user: { findMany: jest.fn().mockResolvedValue(users) } };
    const entry = (key: string, send: jest.Mock) => ({ key, token: key, bot: { api: { sendMessage: send } } });
    const all = [entry('main', main), entry('quva', quva)];
    const registry = { all: () => all, get: (k?: string | null) => all.find((e) => e.key === k), fallback: () => all[0] };
    const proc = new OutboxProcessor(prisma as never, all[0].bot as never, null as never, registry as never);
    const row = { id: 'o1', kind: 'client.spend_applied', payload: { amount: '5000', balanceAfter: '1', tgUserId: 7 }, attempts: 0 };
    const run = () => (proc as never as { dispatchOne: (r: unknown) => Promise<void> }).dispatchOne(row);
    return { main, quva, run, update };
  }

  it('writes to a person through the bot they opened the app from', async () => {
    const { main, quva, run } = multi([{ tgUserId: 7n, lang: 'uz', botKey: 'quva' }]);
    await run();
    expect(quva).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
  });

  it('uses the main bot when nothing is recorded or the recorded bot is unknown', async () => {
    const a = multi([{ tgUserId: 7n, lang: 'uz', botKey: null }]);
    await a.run();
    expect(a.main).toHaveBeenCalledTimes(1);
    const b = multi([{ tgUserId: 7n, lang: 'uz', botKey: 'removed_station' }]);
    await b.run();
    expect(b.main).toHaveBeenCalledTimes(1);
    expect(b.quva).not.toHaveBeenCalled();
  });
});

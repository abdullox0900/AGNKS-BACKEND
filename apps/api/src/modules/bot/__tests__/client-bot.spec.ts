import { ClientBotService } from '../client-bot.service';

type Handler = (ctx: any) => Promise<void>;

function setup(registered: { firstName: string; lang: 'uz' | 'ru' } | null) {
  const handlers = new Map<string, Handler>();
  const bot = {
    command: (name: string, h: Handler) => handlers.set(`command:${name}`, h),
    on: (name: string, h: Handler) => handlers.set(`on:${name}`, h),
  };
  const users = { findRegisteredByTg: jest.fn().mockResolvedValue(registered), registerFromBot: jest.fn() };
  new ClientBotService(bot as never, users as never).onModuleInit();
  const reply = jest.fn();
  const ctx = (text?: string) => ({ from: { id: 7, first_name: 'Ali' }, message: { text }, reply });
  return { handlers, users, reply, ctx };
}

describe('ClientBotService /start', () => {
  it('asks for a name when the client is not registered', async () => {
    const { handlers, reply, ctx } = setup(null);
    await handlers.get('command:start')!(ctx());
    expect(reply.mock.calls[0][0]).toMatch(/ismingizni yozing/);
    // the next text message is taken as the name → phone request
    await handlers.get('on:message:text')!(ctx('Aziz'));
    expect(reply.mock.calls[1][0]).toMatch(/telefon raqamingizni ulashing/);
  });

  it('does not ask again once registered, and does not treat later text as a name', async () => {
    const { handlers, reply, ctx } = setup({ firstName: 'Aziz', lang: 'uz' });
    await handlers.get('command:start')!(ctx());
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toMatch(/allaqachon ro'yxatdan o'tgansiz/);
    await handlers.get('on:message:text')!(ctx('salom'));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('answers in Russian for a Russian-language client', async () => {
    const { handlers, reply, ctx } = setup({ firstName: 'Аzиз', lang: 'ru' });
    await handlers.get('command:start')!(ctx());
    expect(reply.mock.calls[0][0]).toMatch(/уже зарегистрированы/);
  });
});

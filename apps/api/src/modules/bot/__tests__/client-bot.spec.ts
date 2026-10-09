import { ClientBotService } from '../client-bot.service';

type Handler = (ctx: any) => Promise<void>;
type Registered = { firstName: string; lang: 'uz' | 'ru' } | null;

function setup(registered: Registered, registerResult: string = 'registered') {
  const handlers = new Map<string, Handler>();
  const bot = {
    command: (name: string, h: Handler) => handlers.set(`command:${name}`, h),
    on: (name: string, h: Handler) => handlers.set(`on:${name}`, h),
    catch: (h: Handler) => handlers.set('catch', h),
  };
  const users = { setBotKey: jest.fn().mockResolvedValue(undefined), findRegisteredByTg: jest.fn().mockResolvedValue(registered), registerFromBot: jest.fn().mockResolvedValue(registerResult) };
  new ClientBotService(bot as never, users as never).onModuleInit();
  const reply = jest.fn().mockResolvedValue(undefined);
  const ctx = (extra: Record<string, unknown> = {}, lang = 'uz') => ({
    from: { id: 7, first_name: 'Ali', language_code: lang },
    reply,
    ...extra,
  });
  const text = (t: string, lang = 'uz') => ctx({ message: { text: t } }, lang);
  const contact = (userId: number, lang = 'uz') => ctx({ message: { contact: { user_id: userId, phone_number: '998900431160' } } }, lang);
  return { handlers, users, reply, ctx, text, contact };
}

describe('ClientBotService', () => {
  describe('/start', () => {
    it('greets a new client, explains what the bot is for, then asks the name', async () => {
      const { handlers, reply, ctx, text } = setup(null);
      await handlers.get('command:start')!(ctx());
      const welcome = reply.mock.calls[0][0] as string;
      expect(welcome).toMatch(/Assalomu alaykum, Ali/);
      expect(welcome).toMatch(/bonus/);
      expect(welcome).toMatch(/QR/);
      expect(welcome).toMatch(/ismingizni yozing/);
      await handlers.get('on:message:text')!(text('Aziz'));
      expect(reply.mock.calls[1][0]).toMatch(/telefon raqamingizni ulashing/);
    });

    it('writes the welcome in Russian for a Russian Telegram client', async () => {
      const { handlers, reply, ctx } = setup(null);
      await handlers.get('command:start')!(ctx({}, 'ru'));
      expect(reply.mock.calls[0][0]).toMatch(/Добро пожаловать/);
    });

    it('does not ask again once registered, and does not treat later text as a name', async () => {
      const { handlers, reply, ctx, text } = setup({ firstName: 'Aziz', lang: 'uz' });
      await handlers.get('command:start')!(ctx());
      expect(reply).toHaveBeenCalledTimes(1);
      expect(reply.mock.calls[0][0]).toMatch(/allaqachon ro'yxatdan o'tgansiz/);
      await handlers.get('on:message:text')!(text('salom'));
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it('answers a registered Russian-language client in Russian', async () => {
      const { handlers, reply, ctx } = setup({ firstName: 'Азиз', lang: 'ru' });
      await handlers.get('command:start')!(ctx());
      expect(reply.mock.calls[0][0]).toMatch(/уже зарегистрированы/);
    });
  });

  describe('contact', () => {
    it('finishes registration', async () => {
      const { handlers, reply, users, contact } = setup(null, 'registered');
      await handlers.get('on:message:contact')!(contact(7));
      expect(users.registerFromBot).toHaveBeenCalledWith(7, 'Ali', '998900431160', 'uz');
      expect(reply.mock.calls[0][0]).toMatch(/yakunlandi/);
    });

    it('tells a client who is already registered that they are', async () => {
      const { handlers, reply, contact } = setup(null, 'already');
      await handlers.get('on:message:contact')!(contact(7));
      expect(reply.mock.calls[0][0]).toMatch(/allaqachon ro'yxatdan o'tgansiz/);
    });

    it('tells the person when the number belongs to another Telegram account', async () => {
      const { handlers, reply, contact } = setup(null, 'phone_taken');
      await handlers.get('on:message:contact')!(contact(7));
      expect(reply.mock.calls[0][0]).toMatch(/boshqa Telegram akkauntida/);
    });

    it("rejects a contact card that isn't the sender's own", async () => {
      const { handlers, reply, users, contact } = setup(null);
      await handlers.get('on:message:contact')!(contact(999));
      expect(users.registerFromBot).not.toHaveBeenCalled();
      expect(reply.mock.calls[0][0]).toMatch(/o'zingizning raqamingizni/);
    });
  });

  it('replies with an error message instead of staying silent when a handler fails', async () => {
    const { handlers, reply, ctx } = setup(null);
    await handlers.get('catch')!({ error: new Error('boom'), message: 'boom', ctx: { update: { update_id: 1 }, from: ctx().from, reply } });
    expect(reply.mock.calls[0][0]).toMatch(/Xatolik yuz berdi/);
  });
});

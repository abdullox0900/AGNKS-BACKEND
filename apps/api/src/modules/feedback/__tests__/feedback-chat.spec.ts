import { feedbackTemplateSchema, blockClientSchema, replyFeedbackSchema } from '@agnks/types';
import { FeedbackService } from '../feedback.service';
import { AdminClientsService } from '@/modules/users/admin-clients.service';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { AllowBlocked, ALLOW_BLOCKED_KEY } from '@/common/decorators/allow-blocked.decorator';
import { renderMessage } from '@/modules/notifications/message-renderer';

const t = (s: string) => new Date(s);

function feedbackSetup(opts: { card?: any; thread?: any; open?: any } = {}) {
  const prisma: any = {
    card: { findUnique: jest.fn().mockResolvedValue(opts.card ?? { blocked: false }) },
    feedback: {
      create: jest.fn().mockResolvedValue({ id: 'f-new' }),
      findFirst: jest.fn().mockImplementation(async (args: any) => (args.where.kind === 'appeal' ? opts.open ?? null : opts.thread ?? null)),
      findUnique: jest.fn().mockResolvedValue(opts.thread ?? null),
      findMany: jest.fn().mockResolvedValue(opts.thread ? [opts.thread] : []),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    feedbackMessage: { create: jest.fn().mockResolvedValue({}) },
    feedbackTemplate: { findFirst: jest.fn().mockResolvedValue({ sortOrder: 2 }), create: jest.fn().mockResolvedValue({ id: 'tpl', title: 'Salom' }), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    $queryRaw: jest.fn().mockResolvedValue([{ n: 3n }]),
  };
  const notifications = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new FeedbackService(prisma, notifications as never, audit as never), prisma, notifications, audit };
}

const thread = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  cardId: 'c1',
  kind: 'complaint',
  message: 'Skaner ishlamayapti',
  status: 'open',
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: t('2026-10-13T10:00:00Z'),
  lastClientMessageAt: t('2026-10-13T10:00:00Z'),
  lastStaffMessageAt: null,
  staffSeenAt: null,
  clientSeenAt: null,
  messages: [],
  card: { blocked: false, blockedReason: null, user: { id: 'u1', firstName: 'Mamirjon', phone: '+998934813486', lang: 'uz' } },
  ...over,
});

describe('schemas', () => {
  it('reply, template and block reason are validated', () => {
    expect(replyFeedbackSchema.safeParse({ text: 'Rahmat' }).success).toBe(true);
    expect(replyFeedbackSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(feedbackTemplateSchema.safeParse({ title: 'Salom', textUz: 'Murojaatingiz uchun rahmat', textRu: null }).success).toBe(true);
    expect(feedbackTemplateSchema.safeParse({ title: 'S', textUz: 'x' }).success).toBe(false);
    expect(blockClientSchema.safeParse({ reason: 'Soxta cheklar' }).success).toBe(true);
    expect(blockClientSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(blockClientSchema.safeParse({}).success).toBe(false);
  });
});

describe('client side', () => {
  it('a normal client starts a thread of the kind they chose', async () => {
    const { service, prisma } = feedbackSetup();
    expect(await service.create('c1', { kind: 'suggestion', message: 'Yangi nuqta kerak' })).toEqual({ id: 'f-new' });
    expect(prisma.feedback.create).toHaveBeenCalledWith({ data: { cardId: 'c1', kind: 'suggestion', message: 'Yangi nuqta kerak' } });
  });

  it('a blocked client writes an appeal; a second message goes into the same open appeal', async () => {
    const first = feedbackSetup({ card: { blocked: true } });
    await first.service.create('c1', { kind: 'complaint', message: 'Nega blokladingiz?' });
    expect(first.prisma.feedback.create).toHaveBeenCalledWith({ data: { cardId: 'c1', kind: 'appeal', message: 'Nega blokladingiz?' } });

    const again = feedbackSetup({ card: { blocked: true }, open: { id: 'ap1' }, thread: thread({ id: 'ap1' }) });
    expect(await again.service.create('c1', { kind: 'complaint', message: 'Iltimos javob bering' })).toEqual({ id: 'ap1' });
    expect(again.prisma.feedback.create).not.toHaveBeenCalled();
    expect(again.prisma.feedbackMessage.create).toHaveBeenCalledWith({ data: { feedbackId: 'ap1', sender: 'client', body: 'Iltimos javob bering' } });
  });

  it('lists threads newest activity first and marks the ones with an unread answer', async () => {
    const answered = thread({
      lastStaffMessageAt: t('2026-10-13T12:00:00Z'),
      messages: [{ id: 'm1', sender: 'staff', body: "Tuzatdik, rahmat", createdAt: t('2026-10-13T12:00:00Z') }],
    });
    const { service } = feedbackSetup({ thread: answered });
    const [row] = await service.listMine('c1');
    expect(row).toMatchObject({ id: 'f1', unread: true, lastSender: 'staff', preview: 'Tuzatdik, rahmat' });
  });

  it('opening a thread marks it read and returns the bubbles in order', async () => {
    const f = thread({
      lastStaffMessageAt: t('2026-10-13T12:00:00Z'),
      messages: [
        { id: 'm2', sender: 'client', body: 'Rahmat', createdAt: t('2026-10-13T13:00:00Z') },
        { id: 'm1', sender: 'staff', body: 'Tuzatdik', createdAt: t('2026-10-13T12:00:00Z') },
      ],
    });
    const { service, prisma } = feedbackSetup({ thread: f });
    const res = await service.getMine('c1', 'f1');
    expect(res.messages.map((m) => [m.sender, m.text])).toEqual([['client', 'Skaner ishlamayapti'], ['staff', 'Tuzatdik'], ['client', 'Rahmat']]);
    expect(prisma.feedback.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { clientSeenAt: expect.any(Date) } });
  });

  it("writing again reopens a closed thread; someone else's thread is not found", async () => {
    const { service, prisma } = feedbackSetup({ thread: thread({ status: 'resolved' }) });
    await service.replyMine('c1', 'f1', 'Hali ham ishlamayapti');
    expect(prisma.feedback.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: expect.objectContaining({ status: 'open', resolvedAt: null }) });
    const none = feedbackSetup({ thread: null });
    await expect(none.service.replyMine('c1', 'x', 'salom')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(none.service.getMine('c1', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('dashboard side', () => {
  it('lists with unread flags, the client to link to and whether they are blocked', async () => {
    const { service } = feedbackSetup({ thread: thread({ card: { blocked: true, blockedReason: 'x', user: { id: 'u1', firstName: 'Mamirjon', phone: '+998934813486' } } }) });
    const res = await service.adminList('open');
    expect(res.items[0]).toMatchObject({ id: 'f1', unread: true, clientId: 'u1', clientName: 'Mamirjon', blocked: true, preview: 'Skaner ishlamayapti' });
  });

  it('opening a thread marks it seen by staff and returns the client with the block reason', async () => {
    const { service, prisma } = feedbackSetup({ thread: thread({ card: { blocked: true, blockedReason: 'Soxta cheklar', user: { id: 'u1', firstName: 'Ali', phone: '+998901112233', lang: 'ru' } } }) });
    const res = await service.adminGet('f1');
    expect(res.client).toMatchObject({ id: 'u1', blocked: true, blockedReason: 'Soxta cheklar', lang: 'ru' });
    expect(prisma.feedback.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { staffSeenAt: expect.any(Date) } });
  });

  it('a reply is stored, queued for Telegram and logged', async () => {
    const { service, prisma, notifications, audit } = feedbackSetup({ thread: thread() });
    await service.adminReply('f1', 'Rahmat, tuzatamiz', 'staff1');
    expect(prisma.feedbackMessage.create).toHaveBeenCalledWith({ data: { feedbackId: 'f1', sender: 'staff', authorId: 'staff1', body: 'Rahmat, tuzatamiz' } });
    expect(notifications.enqueue).toHaveBeenCalledWith('client.feedback_reply', { cardId: 'c1', feedbackId: 'f1', text: 'Rahmat, tuzatamiz' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'feedback.reply' }));
  });

  it('closing with a note also sends the note as the last answer; closing without one sends nothing', async () => {
    const withNote = feedbackSetup({ thread: thread() });
    await withNote.service.resolve('f1', 'staff1', 'Muammo hal qilindi');
    expect(withNote.notifications.enqueue).toHaveBeenCalledWith('client.feedback_reply', expect.objectContaining({ text: 'Muammo hal qilindi' }));
    const plain = feedbackSetup({ thread: thread() });
    await plain.service.resolve('f1', 'staff1');
    expect(plain.notifications.enqueue).not.toHaveBeenCalled();
  });

  it('deletes a whole conversation and leaves a trace in the log', async () => {
    const { service, prisma, audit } = feedbackSetup({ thread: thread({ messages: [{ id: 'm1', sender: 'staff', body: 'Salom', createdAt: t('2026-10-13T12:00:00Z') }] }) });
    expect(await service.remove('f1', 'seo1')).toEqual({ id: 'f1' });
    expect(prisma.feedback.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'feedback.delete', before: { client: 'Mamirjon', kind: 'complaint', status: 'open', messages: 2, first: 'Skaner ishlamayapti' } }));
    await expect(feedbackSetup({ thread: null }).service.remove('nope', 'seo1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('counts unread threads for the sidebar badge', async () => {
    const { service } = feedbackSetup();
    expect(await service.adminUnreadCount()).toEqual({ count: 3 });
  });

  it('creates a template at the end of the list', async () => {
    const { service, prisma } = feedbackSetup();
    await service.createTemplate({ title: 'Salom', textUz: 'Murojaatingiz uchun rahmat', textRu: null }, 'seo1');
    expect(prisma.feedbackTemplate.create).toHaveBeenCalledWith({ data: { title: 'Salom', textUz: 'Murojaatingiz uchun rahmat', textRu: null, sortOrder: 3 } });
  });
});

describe('blocking with a reason', () => {
  function blockSetup() {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', card: { id: 'c1', blockedReason: null } }) },
      card: { update: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = { enqueue: jest.fn().mockResolvedValue(undefined) };
    return { service: new AdminClientsService(prisma, {} as never, audit as never, notifications as never), prisma, audit, notifications };
  }

  it('stores the reason, tells the client, and refuses a block without one', async () => {
    const { service, prisma, notifications, audit } = blockSetup();
    await service.setBlocked('u1', true, 'seo1', '  Soxta cheklar  ');
    expect(prisma.card.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { blocked: true, blockedReason: 'Soxta cheklar', blockedAt: expect.any(Date) } });
    expect(notifications.enqueue).toHaveBeenCalledWith('client.blocked', { cardId: 'c1', reason: 'Soxta cheklar' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'client.block', after: { reason: 'Soxta cheklar' } }));
    await expect(service.setBlocked('u1', true, 'seo1', '   ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('unblocking clears the reason and tells the client', async () => {
    const { service, prisma, notifications } = blockSetup();
    await service.setBlocked('u1', false, 'seo1');
    expect(prisma.card.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { blocked: false, blockedReason: null, blockedAt: null } });
    expect(notifications.enqueue).toHaveBeenCalledWith('client.unblocked', { cardId: 'c1' });
  });
});

describe('ClientAuthGuard and blocked cards', () => {
  class Open {
    @AllowBlocked()
    allowed() {}
    denied() {}
  }
  function guardFor(handler: () => void) {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'active', botKey: 'main', card: { id: 'c1', blocked: true } }),
        update: jest.fn(),
      },
    };
    const initData = { validate: () => ({ user: { id: 7, first_name: 'A' }, botKey: 'main' }) };
    const reflector = { getAllAndOverride: (key: string, targets: Function[]) => (key === ALLOW_BLOCKED_KEY ? Reflect.getMetadata(key, targets[0]) : undefined) };
    const guard = new ClientAuthGuard(initData as never, prisma, reflector as never);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ header: () => 'tma x' }) }), getHandler: () => handler, getClass: () => Open };
    return { guard, ctx: ctx as never };
  }

  it('lets a blocked client through only on routes marked AllowBlocked', async () => {
    const proto = Open.prototype as unknown as Record<string, () => void>;
    const ok = guardFor(proto.allowed);
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);
    const no = guardFor(proto.denied);
    await expect(no.guard.canActivate(no.ctx)).rejects.toMatchObject({ code: 'CARD_BLOCKED' });
  });
});

describe('notification texts', () => {
  it('the three new messages exist in both languages', () => {
    expect(renderMessage('client.feedback_reply', { text: 'Tuzatdik' }, 'uz')).toContain('Tuzatdik');
    expect(renderMessage('client.blocked', { reason: 'Soxta cheklar' }, 'uz')).toMatch(/bloklandi[\s\S]*Soxta cheklar/);
    expect(renderMessage('client.blocked', { reason: 'Фейк' }, 'ru')).toMatch(/заблокирован[\s\S]*Фейк/);
    expect(renderMessage('client.unblocked', {}, 'uz')).toMatch(/faollashtirildi/);
    expect(renderMessage('client.feedback_reply', { text: '<b>x</b>' }, 'uz')).not.toContain('<b>x</b>'); // user text is escaped
  });
});

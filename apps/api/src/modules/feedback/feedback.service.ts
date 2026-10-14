import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, type FeedbackCreateDto, type FeedbackTemplateDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AuditService } from '@/modules/audit/audit.service';

const EPOCH = new Date(0);
const PREVIEW = 90;
const preview = (s: string) => (s.length > PREVIEW ? `${s.slice(0, PREVIEW).trimEnd()}…` : s);

type ThreadRow = Prisma.FeedbackGetPayload<{ include: { messages: true } }>;

/** One bubble in a thread: the client's first message is `Feedback.message`, the rest are `FeedbackMessage` rows. */
function bubbles(f: ThreadRow) {
  const out: { id: string; sender: 'client' | 'staff'; text: string; at: string }[] = [{ id: `first-${f.id}`, sender: 'client', text: f.message, at: f.createdAt.toISOString() }];
  for (const m of [...f.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    out.push({ id: m.id, sender: m.sender, text: m.body, at: m.createdAt.toISOString() });
  }
  // threads closed before the chat existed kept their closing note on the row itself — show it as the answer
  if (f.resolutionNote && !f.messages.some((m) => m.sender === 'staff')) {
    out.push({ id: `note-${f.id}`, sender: 'staff', text: f.resolutionNote, at: (f.resolvedAt ?? f.createdAt).toISOString() });
  }
  return out;
}

const lastOf = (f: ThreadRow) => bubbles(f).at(-1)!;
const activityAt = (f: { lastClientMessageAt: Date; lastStaffMessageAt: Date | null }) =>
  f.lastStaffMessageAt && f.lastStaffMessageAt > f.lastClientMessageAt ? f.lastStaffMessageAt : f.lastClientMessageAt;

/**
 * "Taklif va shikoyat" as a conversation: the client writes, the dashboard answers (free text or a ready-made
 * template), the client sees the answer in the app and in Telegram. A blocked client uses the same thread type
 * (`appeal`) to ask to be unblocked.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- client

  /** A new thread — or, for a blocked client who already has an open appeal, one more message in it. */
  async create(cardId: string, dto: FeedbackCreateDto) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { blocked: true } });
    if (card?.blocked) {
      const open = await this.prisma.feedback.findFirst({ where: { cardId, kind: 'appeal', status: 'open' }, orderBy: { createdAt: 'desc' } });
      if (open) return this.replyMine(cardId, open.id, dto.message);
      const appeal = await this.prisma.feedback.create({ data: { cardId, kind: 'appeal', message: dto.message } });
      return { id: appeal.id };
    }
    const feedback = await this.prisma.feedback.create({ data: { cardId, kind: dto.kind, message: dto.message } });
    return { id: feedback.id };
  }

  async listMine(cardId: string) {
    const rows = await this.prisma.feedback.findMany({ where: { cardId }, include: { messages: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        status: f.status,
        preview: preview(lastOf(f).text),
        lastSender: lastOf(f).sender,
        lastActivityAt: activityAt(f).toISOString(),
        unread: !!f.lastStaffMessageAt && f.lastStaffMessageAt > (f.clientSeenAt ?? EPOCH),
      }))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  /** Opening a thread counts as reading it. */
  async getMine(cardId: string, id: string) {
    const f = await this.prisma.feedback.findFirst({ where: { id, cardId }, include: { messages: true } });
    if (!f) throw new AppError('NOT_FOUND');
    await this.prisma.feedback.update({ where: { id }, data: { clientSeenAt: new Date() } });
    return { id: f.id, kind: f.kind, status: f.status, messages: bubbles(f) };
  }

  /** The client writes again: it reopens a closed thread and shows up as unread in the dashboard. */
  async replyMine(cardId: string, id: string, text: string) {
    const f = await this.prisma.feedback.findFirst({ where: { id, cardId }, select: { id: true } });
    if (!f) throw new AppError('NOT_FOUND');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.feedbackMessage.create({ data: { feedbackId: id, sender: 'client', body: text } }),
      this.prisma.feedback.update({ where: { id }, data: { lastClientMessageAt: now, clientSeenAt: now, status: 'open', resolvedAt: null, resolvedBy: null } }),
    ]);
    return { id };
  }

  // ---------------------------------------------------------------- dashboard

  async adminList(status?: string, cursor?: string, limit = 30) {
    const rows = await this.prisma.feedback.findMany({
      where: { status: status as never },
      include: { card: { include: { user: true } }, messages: true },
      orderBy: [{ lastClientMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((f) => {
        const last = lastOf(f);
        return {
          id: f.id,
          kind: f.kind,
          status: f.status,
          message: f.message,
          preview: preview(last.text),
          lastSender: last.sender,
          createdAt: f.createdAt.toISOString(),
          lastActivityAt: activityAt(f).toISOString(),
          unread: f.lastClientMessageAt > (f.staffSeenAt ?? EPOCH),
          resolutionNote: f.resolutionNote,
          clientId: f.card.user.id,
          clientName: f.card.user.firstName,
          clientPhone: f.card.user.phone,
          blocked: f.card.blocked,
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Threads with a client message nobody on the dashboard has opened yet — the sidebar badge. */
  async adminUnreadCount() {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      select count(*)::bigint as n from feedback
      where last_client_message_at > coalesce(staff_seen_at, 'epoch'::timestamp)`;
    return { count: Number(n) };
  }

  async adminGet(id: string, markSeen = true) {
    const f = await this.prisma.feedback.findUnique({ where: { id }, include: { card: { include: { user: true } }, messages: true } });
    if (!f) throw new AppError('NOT_FOUND');
    if (markSeen) await this.prisma.feedback.update({ where: { id }, data: { staffSeenAt: new Date() } });
    return {
      id: f.id,
      kind: f.kind,
      status: f.status,
      messages: bubbles(f),
      client: {
        id: f.card.user.id,
        name: f.card.user.firstName,
        phone: f.card.user.phone,
        lang: f.card.user.lang,
        blocked: f.card.blocked,
        blockedReason: f.card.blockedReason,
      },
    };
  }

  async adminReply(id: string, text: string, staffId: string) {
    const f = await this.prisma.feedback.findUnique({ where: { id }, select: { id: true, cardId: true } });
    if (!f) throw new AppError('NOT_FOUND');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.feedbackMessage.create({ data: { feedbackId: id, sender: 'staff', authorId: staffId, body: text } }),
      this.prisma.feedback.update({ where: { id }, data: { lastStaffMessageAt: now, staffSeenAt: now } }),
    ]);
    await this.notifications.enqueue('client.feedback_reply', { cardId: f.cardId, feedbackId: id, text });
    await this.audit.record({ actorId: staffId, action: 'feedback.reply', entityType: 'feedback', entityId: id, after: { text: preview(text) } });
    return { id };
  }

  /** Closing a thread; a note, if given, is sent to the client as the last answer. */
  async resolve(id: string, resolverId: string, note?: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new AppError('NOT_FOUND');
    if (feedback.status !== 'open') return feedback;

    const updated = await this.prisma.feedback.update({
      where: { id },
      data: { status: 'resolved', resolvedBy: resolverId, resolvedAt: new Date(), resolutionNote: note, staffSeenAt: new Date() },
    });
    await this.audit.record({ actorId: resolverId, action: 'feedback.resolve', entityType: 'feedback', entityId: id, after: { note: note ?? null } });
    if (note?.trim()) await this.adminReply(id, note.trim(), resolverId);
    return updated;
  }

  // --------------------------------------------------------------- templates

  listTemplates() {
    return this.prisma.feedbackTemplate.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async createTemplate(dto: FeedbackTemplateDto, actorId: string) {
    const last = await this.prisma.feedbackTemplate.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const row = await this.prisma.feedbackTemplate.create({ data: { title: dto.title, textUz: dto.textUz, textRu: dto.textRu ?? null, sortOrder: (last?.sortOrder ?? 0) + 1 } });
    await this.audit.record({ actorId, action: 'feedback.template_create', entityType: 'feedback_template', entityId: row.id, after: { title: row.title } });
    return row;
  }

  async updateTemplate(id: string, dto: FeedbackTemplateDto, actorId: string) {
    const before = await this.prisma.feedbackTemplate.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    const row = await this.prisma.feedbackTemplate.update({ where: { id }, data: { title: dto.title, textUz: dto.textUz, textRu: dto.textRu ?? null } });
    await this.audit.record({ actorId, action: 'feedback.template_update', entityType: 'feedback_template', entityId: id, before: { title: before.title }, after: { title: row.title } });
    return row;
  }

  async removeTemplate(id: string, actorId: string) {
    const before = await this.prisma.feedbackTemplate.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    await this.prisma.feedbackTemplate.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'feedback.template_delete', entityType: 'feedback_template', entityId: id, before: { title: before.title } });
    return { id };
  }
}

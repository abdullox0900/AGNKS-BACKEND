import { Injectable } from '@nestjs/common';
import { AppError, type FeedbackCreateDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(cardId: string, dto: FeedbackCreateDto) {
    const feedback = await this.prisma.feedback.create({
      data: { cardId, kind: dto.kind, message: dto.message },
    });
    await this.notifications.enqueue('staff.anomaly', {
      reason: 'feedback_received',
      feedbackId: feedback.id,
      kind: dto.kind,
    });
    return feedback;
  }

  listMine(cardId: string) {
    return this.prisma.feedback.findMany({ where: { cardId }, orderBy: { createdAt: 'desc' } });
  }

  async adminList(status?: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.feedback.findMany({
      where: { status: status as never },
      include: { card: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((f) => ({ ...f, clientName: f.card.user.firstName, clientPhone: f.card.user.phone })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async resolve(id: string, resolverId: string, note?: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new AppError('NOT_FOUND');
    if (feedback.status !== 'open') return feedback;

    return this.prisma.feedback.update({
      where: { id },
      data: { status: 'resolved', resolvedBy: resolverId, resolvedAt: new Date(), resolutionNote: note },
    });
  }
}

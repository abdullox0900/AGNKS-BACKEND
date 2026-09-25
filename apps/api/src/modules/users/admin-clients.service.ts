import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AuditService } from '@/modules/audit/audit.service';

@Injectable()
export class AdminClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async search(q?: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.user.findMany({
      where: q
        ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
        : undefined,
      include: { card: true },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const [receipts, spends] = await Promise.all([
      this.prisma.receipt.findMany({ where: { cardId: user.card.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.spendOperation.findMany({ where: { cardId: user.card.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    return { user, card: user.card, recentReceipts: receipts, recentSpends: spends };
  }

  async rename(id: string, firstName: string, actorId: string) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');

    const user = await this.prisma.user.update({ where: { id }, data: { firstName } });
    await this.audit.record({ actorId, action: 'client.rename', entityType: 'user', entityId: id, before, after: user });
    return user;
  }

  async adjust(id: string, delta: number, note: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const result = await this.prisma.$transaction(async (tx) => {
      const posted = await this.ledger.post(tx, {
        cardId: user.card!.id,
        delta: BigInt(delta),
        type: 'adjust',
        refType: 'manual',
        refId: id,
        actorId,
      });
      return posted;
    });

    await this.audit.record({
      actorId,
      action: 'client.adjust',
      entityType: 'card',
      entityId: user.card.id,
      after: { delta, note, balanceAfter: result.balanceAfter.toString() },
    });

    return { balanceAfter: Number(result.balanceAfter) };
  }

  async setBlocked(id: string, blocked: boolean, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { card: true } });
    if (!user || !user.card) throw new AppError('NOT_FOUND');

    const card = await this.prisma.card.update({ where: { id: user.card.id }, data: { blocked } });

    await this.audit.record({
      actorId,
      action: blocked ? 'client.block' : 'client.unblock',
      entityType: 'card',
      entityId: card.id,
    });

    return card;
  }
}

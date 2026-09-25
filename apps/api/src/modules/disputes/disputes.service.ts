import { Injectable } from '@nestjs/common';
import { AppError, type DisputeCreateDto, type ResolveDisputeDto } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(cardId: string, dto: DisputeCreateDto) {
    const existing = await this.prisma.dispute.findFirst({
      where: { refType: dto.refType, refId: dto.refId, status: 'open' },
    });
    if (existing) throw new AppError('DISPUTE_ALREADY_OPEN');

    if (dto.refType === 'receipt') {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: dto.refId } });
      if (!receipt || receipt.cardId !== cardId) throw new AppError('NOT_FOUND');
    } else {
      const spend = await this.prisma.spendOperation.findUnique({ where: { id: dto.refId } });
      if (!spend || spend.cardId !== cardId) throw new AppError('NOT_FOUND');
    }

    const dispute = await this.prisma.dispute.create({
      data: {
        cardId,
        refType: dto.refType,
        refId: dto.refId,
        claimedAmount: dto.claimedAmount !== undefined ? BigInt(dto.claimedAmount) : null,
        comment: dto.comment,
      },
    });

    await this.notifications.enqueue('staff.anomaly', {
      reason: 'dispute_opened',
      disputeId: dispute.id,
      refType: dto.refType,
      refId: dto.refId,
    });

    return dispute;
  }

  async listMine(cardId: string) {
    return this.prisma.dispute.findMany({ where: { cardId }, orderBy: { createdAt: 'desc' } });
  }

  async adminList(status?: string, cursor?: string, limit = 20) {
    const rows = await this.prisma.dispute.findMany({
      where: { status: status as never },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map((d) => this.enrich(d)));
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async adminDetail(id: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new AppError('NOT_FOUND');
    return this.enrich(dispute);
  }

  /** The raw dispute row only has cardId + a polymorphic refId — join in the
   * client/station/cashier names an operator actually needs to decide on it. */
  private async enrich(dispute: {
    id: string;
    cardId: string;
    refType: string;
    refId: string;
    claimedAmount: bigint | null;
    comment: string | null;
    status: string;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    createdAt: Date;
  }) {
    const card = await this.prisma.card.findUnique({ where: { id: dispute.cardId }, include: { user: true } });

    let actualAmount = 0n;
    let stationName = '';
    let cashierName: string | null = null;

    if (dispute.refType === 'receipt') {
      const receipt = await this.prisma.receipt.findUnique({
        where: { id: dispute.refId },
        include: { station: true },
      });
      actualAmount = receipt?.bonus ?? 0n;
      stationName = receipt?.station.name ?? '';
    } else {
      const spend = await this.prisma.spendOperation.findUnique({
        where: { id: dispute.refId },
        include: { station: true },
      });
      actualAmount = spend?.amount ?? 0n;
      stationName = spend?.station.name ?? '';
      if (spend) {
        const cashier = await this.prisma.user.findUnique({ where: { id: spend.cashierId } });
        cashierName = cashier?.firstName ?? null;
      }
    }

    return {
      ...dispute,
      clientName: card?.user.firstName ?? '',
      cashierName,
      stationName,
      actualAmount,
    };
  }

  async resolve(id: string, resolverId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new AppError('NOT_FOUND');
    if (dispute.status !== 'open') return dispute;

    return this.prisma.$transaction(async (tx) => {
      if (dto.resolution === 'reversed' && dispute.refType === 'spend') {
        const spend = await tx.spendOperation.findUnique({ where: { id: dispute.refId } });
        if (spend && spend.status === 'applied') {
          await this.ledger.post(tx, {
            cardId: dispute.cardId,
            delta: spend.amount,
            type: 'reverse',
            refType: 'dispute',
            refId: dispute.id,
            actorId: resolverId,
          });
          await tx.spendOperation.update({
            where: { id: spend.id },
            data: { status: 'reversed', reversedBy: resolverId, reversedAt: new Date(), reverseReason: 'dispute' },
          });
        }
      } else if (dto.resolution === 'adjusted' && dto.amount !== undefined) {
        await this.ledger.post(tx, {
          cardId: dispute.cardId,
          delta: BigInt(dto.amount),
          type: 'adjust',
          refType: 'dispute',
          refId: dispute.id,
          actorId: resolverId,
        });
      }

      const updated = await tx.dispute.update({
        where: { id },
        data: {
          status: dto.resolution,
          resolvedBy: resolverId,
          resolvedAt: new Date(),
          resolutionNote: dto.note,
        },
      });

      await this.notifications.enqueue(
        'client.dispute_resolved',
        { cardId: dispute.cardId, disputeId: id, resolution: dto.resolution },
        tx,
      );

      return updated;
    });
  }
}

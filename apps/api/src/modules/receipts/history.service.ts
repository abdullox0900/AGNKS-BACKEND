import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';

export type HistoryType = 'earn' | 'spend';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(cardId: string, cursor: string | undefined, limit: number, type?: HistoryType) {
    const before = cursor ? decodeCursor(cursor) : null;

    const [receipts, spends] = await Promise.all([
      type === 'spend'
        ? []
        : this.prisma.receipt.findMany({
            where: { cardId, createdAt: before ? { lt: before } : undefined },
            include: { station: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
      type === 'earn'
        ? []
        : this.prisma.spendOperation.findMany({
            where: { cardId, createdAt: before ? { lt: before } : undefined },
            include: { station: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
    ]);

    const merged = [
      ...receipts.map((r) => ({
        type: 'earn' as const,
        id: r.id,
        createdAt: r.createdAt,
        stationName: r.station.name,
        amount: Number(r.bonus),
        status: r.status,
        receiptAmount: Number(r.amount),
        ratePercent: r.rateBps / 100,
        operationNumber: `E-${r.id.slice(0, 8)}`,
      })),
      ...spends.map((s) => ({
        type: 'spend' as const,
        id: s.id,
        createdAt: s.createdAt,
        stationName: s.station.name,
        amount: -Number(s.amount),
        status: s.status === 'reversed' ? 'reversed' : 'applied',
        operationNumber: `S-${s.id.slice(0, 8)}`,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const page = merged.slice(0, limit);
    const nextCursor = page.length === limit ? encodeCursor(page[page.length - 1].createdAt) : null;

    return {
      items: page.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      nextCursor,
    };
  }

  async getOne(cardId: string, type: HistoryType, id: string) {
    const refType = type === 'earn' ? 'receipt' : 'spend';
    const dispute = await this.prisma.dispute.findFirst({ where: { cardId, refType, refId: id, status: 'open' } });

    if (type === 'earn') {
      const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { station: true } });
      if (!receipt || receipt.cardId !== cardId) throw new AppError('NOT_FOUND');
      return { ...receipt, disputeSent: !!dispute };
    }
    const spend = await this.prisma.spendOperation.findUnique({ where: { id }, include: { station: true } });
    if (!spend || spend.cardId !== cardId) throw new AppError('NOT_FOUND');
    const cashier = await this.prisma.user.findUnique({ where: { id: spend.cashierId } });
    return { ...spend, cashierName: cashier?.firstName ?? null, disputeSent: !!dispute };
  }
}

function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string): Date {
  try {
    return new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_ERROR', { message: 'invalid cursor' });
  }
}

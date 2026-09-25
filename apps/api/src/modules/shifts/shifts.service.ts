import { Injectable } from '@nestjs/common';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { StaffActor } from '@/common/types/actor';

const FORGOTTEN_HOURS = 14;

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async me(actor: StaffActor) {
    const [user, roleRow, currentShift] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actor.userId } }),
      this.prisma.userRole.findFirst({ where: { userId: actor.userId, role: 'cashier' }, include: { station: true } }),
      this.prisma.shift.findFirst({ where: { cashierId: actor.userId, status: 'open' } }),
    ]);
    if (!user || !roleRow) throw new AppError('AUTH_STAFF_NOT_FOUND');

    const terminals = roleRow.terminalIds.length
      ? await this.prisma.terminal.findMany({ where: { id: { in: roleRow.terminalIds } } })
      : [];

    return {
      firstName: user.firstName,
      station: roleRow.station ? { id: roleRow.station.id, name: roleRow.station.name } : null,
      terminals: terminals.map((t) => ({ id: t.id, label: t.label })),
      currentShift: currentShift ? await this.toShiftDtoWithStats(currentShift) : null,
    };
  }

  async currentShift(actor: StaffActor) {
    const shift = await this.prisma.shift.findFirst({ where: { cashierId: actor.userId, status: 'open' } });
    return shift ? this.toShiftDtoWithStats(shift) : null;
  }

  private async toShiftDtoWithStats(shift: Parameters<typeof toShiftDto>[0]) {
    const agg = await this.prisma.spendOperation.aggregate({
      where: { shiftId: shift.id, status: 'applied' },
      _count: { _all: true },
      _sum: { amount: true },
    });
    return {
      ...toShiftDto(shift),
      operationsCount: agg._count._all,
      operationsSum: Number(agg._sum.amount ?? 0n),
    };
  }

  async listMine(actor: StaffActor, cursor?: string, limit = 20) {
    const rows = await this.prisma.shift.findMany({
      where: { cashierId: actor.userId },
      orderBy: { openedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page.map(toShiftDto), nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async adminList(filters: { status?: string; stationId?: string; from?: string; to?: string }) {
    const shifts = await this.prisma.shift.findMany({
      where: {
        status: filters.status as never,
        stationId: filters.stationId,
        openedAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: filters.to ? new Date(filters.to) : undefined,
        },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
    const cashiers = await this.prisma.user.findMany({ where: { id: { in: shifts.map((s) => s.cashierId) } } });
    const cashierNames = new Map(cashiers.map((c) => [c.id, c.firstName]));
    const counts = await this.prisma.spendOperation.groupBy({
      by: ['shiftId'],
      where: { shiftId: { in: shifts.map((s) => s.id) }, status: 'applied' },
      _count: { _all: true },
    });
    const countByShift = new Map(counts.map((c) => [c.shiftId, c._count._all]));
    return shifts.map((s) => ({
      ...toShiftDto(s),
      cashierName: cashierNames.get(s.cashierId) ?? '',
      operationsCount: countByShift.get(s.id) ?? 0,
    }));
  }

  async adminDetail(id: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new AppError('NOT_FOUND');
    const cashier = await this.prisma.user.findUnique({ where: { id: shift.cashierId } });
    const receipts = await this.prisma.receipt.findMany({ where: { shiftId: id }, select: { id: true, amount: true, status: true } });
    const spends = await this.prisma.spendOperation.findMany({ where: { shiftId: id }, select: { id: true, amount: true, status: true, createdAt: true } });
    return { shift: { ...toShiftDto(shift), cashierName: cashier?.firstName ?? '' }, receiptsCount: receipts.length, receipts, spends };
  }

  /** `shift.forgotten` job — reminds a manager once a shift has been open too long. */
  async findForgottenShifts() {
    const cutoff = new Date(Date.now() - FORGOTTEN_HOURS * 60 * 60 * 1000);
    return this.prisma.shift.findMany({ where: { status: 'open', openedAt: { lt: cutoff } } });
  }
}

function toShiftDto(shift: {
  id: string;
  stationId: string;
  openedAt: Date;
  closedAt: Date | null;
  declaredTotal: bigint | null;
  claimsTotal: bigint | null;
  status: string;
  flagReason: string | null;
}) {
  return {
    id: shift.id,
    stationId: shift.stationId,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    declaredTotal: shift.declaredTotal !== null ? Number(shift.declaredTotal) : null,
    claimsTotal: shift.claimsTotal !== null ? Number(shift.claimsTotal) : null,
    status: shift.status,
    flagReason: shift.flagReason,
  };
}

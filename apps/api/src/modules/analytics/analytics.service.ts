import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnalyticsMetric } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface AnalyticsFilter {
  from: Date;
  to: Date;
  stationIds?: string[];
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(filter: AnalyticsFilter) {
    const stationFilter = stationWhere(filter.stationIds);

    const [receiptAgg, spendAgg, activeClients, pendingReview, openDisputes] = await Promise.all([
      this.prisma.receipt.aggregate({
        where: { createdAt: { gte: filter.from, lte: filter.to }, status: { not: 'rejected' }, ...stationFilter },
        _count: { _all: true },
        _sum: { amount: true, bonus: true },
      }),
      this.prisma.spendOperation.aggregate({
        where: { createdAt: { gte: filter.from, lte: filter.to }, status: 'applied', ...stationFilter },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.receipt.findMany({
        where: { createdAt: { gte: filter.from, lte: filter.to }, ...stationFilter },
        select: { cardId: true },
        distinct: ['cardId'],
      }),
      this.prisma.receipt.count({ where: { status: 'pending_review', ...stationFilter } }),
      this.prisma.dispute.count({ where: { status: 'open' } }),
    ]);

    return {
      receipts: { count: receiptAgg._count._all, sum: Number(receiptAgg._sum.amount ?? 0n) },
      bonus: { issued: Number(receiptAgg._sum.bonus ?? 0n) },
      spend: { count: spendAgg._count._all, sum: Number(spendAgg._sum.amount ?? 0n) },
      activeClients: activeClients.length,
      attention: { pendingReview, openDisputes },
    };
  }

  async alerts(stationIds?: string[]) {
    const stationFilter = stationWhere(stationIds);
    const [openDisputes, pendingReview] = await Promise.all([
      this.prisma.dispute.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.receipt.findMany({ where: { status: 'pending_review', ...stationFilter }, orderBy: { createdAt: 'asc' }, take: 20 }),
    ]);
    return { openDisputes, pendingReview };
  }

  async series(metric: AnalyticsMetric, filter: AnalyticsFilter, granularity: 'day' | 'week' | 'month') {
    switch (metric) {
      case 'receipts':
        return this.timeSeries('receipts', 'amount', filter, granularity);
      case 'bonus':
        return this.timeSeries('receipts', 'bonus', filter, granularity);
      case 'clients':
        return this.newClientsSeries(filter, granularity);
      case 'stations':
        return this.byStation(filter);
      case 'cashiers':
        return this.byCashier(filter);
      case 'hours':
        return this.byHourOfDay(filter);
    }
  }

  private async timeSeries(
    table: 'receipts',
    column: 'amount' | 'bonus',
    filter: AnalyticsFilter,
    granularity: 'day' | 'week' | 'month',
  ) {
    // station_id is a plain `text` column (Prisma's default @id mapping), not native uuid.
    const stationClause = filter.stationIds?.length
      ? Prisma.sql`AND station_id = ANY(${filter.stationIds}::text[])`
      : Prisma.empty;

    return this.prisma.$queryRaw<{ bucket: Date; count: bigint; sum: bigint }[]>`
      SELECT date_trunc(${granularity}, receipt_at AT TIME ZONE 'Asia/Tashkent') AS bucket,
             COUNT(*)::bigint AS count,
             COALESCE(SUM(${Prisma.raw(column)}), 0)::bigint AS sum
      FROM receipts
      WHERE receipt_at BETWEEN ${filter.from} AND ${filter.to}
        AND status != 'rejected'
        ${stationClause}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  private async newClientsSeries(filter: AnalyticsFilter, granularity: 'day' | 'week' | 'month') {
    return this.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT date_trunc(${granularity}, u.created_at AT TIME ZONE 'Asia/Tashkent') AS bucket,
             COUNT(*)::bigint AS count
      FROM users u
      JOIN cards c ON c.user_id = u.id
      WHERE u.created_at BETWEEN ${filter.from} AND ${filter.to}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  private async byStation(filter: AnalyticsFilter) {
    return this.prisma.$queryRaw<{ stationId: string; name: string; count: bigint; sum: bigint }[]>`
      SELECT s.id AS "stationId", s.name, COUNT(r.id)::bigint AS count, COALESCE(SUM(r.amount), 0)::bigint AS sum
      FROM stations s
      LEFT JOIN receipts r ON r.station_id = s.id AND r.receipt_at BETWEEN ${filter.from} AND ${filter.to} AND r.status != 'rejected'
      GROUP BY s.id, s.name
      ORDER BY sum DESC
    `;
  }

  private async byCashier(filter: AnalyticsFilter) {
    return this.prisma.$queryRaw<{ cashierId: string; firstName: string; count: bigint; sum: bigint }[]>`
      SELECT so.cashier_id AS "cashierId", u.first_name AS "firstName", COUNT(*)::bigint AS count, COALESCE(SUM(so.amount), 0)::bigint AS sum
      FROM spend_operations so
      JOIN users u ON u.id = so.cashier_id
      WHERE so.created_at BETWEEN ${filter.from} AND ${filter.to} AND so.status = 'applied'
      GROUP BY so.cashier_id, u.first_name
      ORDER BY sum DESC
    `;
  }

  private async byHourOfDay(filter: AnalyticsFilter) {
    return this.prisma.$queryRaw<{ hour: number; count: bigint; sum: bigint }[]>`
      SELECT EXTRACT(HOUR FROM receipt_at AT TIME ZONE 'Asia/Tashkent')::int AS hour,
             COUNT(*)::bigint AS count,
             COALESCE(SUM(amount), 0)::bigint AS sum
      FROM receipts
      WHERE receipt_at BETWEEN ${filter.from} AND ${filter.to} AND status != 'rejected'
      GROUP BY 1
      ORDER BY 1
    `;
  }
}

function stationWhere(stationIds?: string[]) {
  return stationIds && stationIds.length > 0 ? { stationId: { in: stationIds } } : {};
}

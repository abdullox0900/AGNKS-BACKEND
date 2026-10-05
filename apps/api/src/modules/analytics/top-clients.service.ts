import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { ReportFilter } from './bonus-report.service';

export interface TopClient {
  userId: string;
  name: string;
  phone: string | null;
  /** applied receipts scanned in the period */
  receiptsCount: number;
  receiptsSum: number;
  /** current bonus balance (not limited to the period) */
  balance: number;
}

const num = (v: unknown) => Number(v ?? 0);

/** The five most active clients: by receipts scanned in the period, and by bonus balance right now. */
@Injectable()
export class TopClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async top(f: ReportFilter, limit = 5): Promise<{ byReceipts: TopClient[]; byBalance: TopClient[] }> {
    const station = f.stationIds?.length ? Prisma.sql`AND r.station_id = ANY(${f.stationIds}::text[])` : Prisma.empty;
    // with a station selected, "balance" ranks only clients who have scanned there at some point
    const onlyHere = f.stationIds?.length
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM receipts rr WHERE rr.card_id = c.id AND rr.station_id = ANY(${f.stationIds}::text[]))`
      : Prisma.empty;

    const select = Prisma.sql`
      SELECT u.id AS "userId", u.first_name AS name, u.phone,
             COALESCE(p.cnt, 0) AS "receiptsCount", COALESCE(p.sum, 0) AS "receiptsSum", c.cached_balance AS balance
      FROM cards c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN (
        SELECT r.card_id, COUNT(*)::bigint AS cnt, SUM(r.amount)::bigint AS sum
        FROM receipts r
        WHERE r.status = 'applied' AND r.created_at BETWEEN ${f.from} AND ${f.to} ${station}
        GROUP BY r.card_id
      ) p ON p.card_id = c.id`;

    const [byReceipts, byBalance] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`${select} WHERE COALESCE(p.cnt, 0) > 0 ORDER BY p.cnt DESC, p.sum DESC, c.cached_balance DESC LIMIT ${limit}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`${select} WHERE c.cached_balance > 0 ${onlyHere} ORDER BY c.cached_balance DESC, COALESCE(p.cnt, 0) DESC LIMIT ${limit}`,
    ]);
    const map = (r: Record<string, unknown>): TopClient => ({
      userId: String(r.userId),
      name: String(r.name),
      phone: (r.phone as string | null) ?? null,
      receiptsCount: num(r.receiptsCount),
      receiptsSum: num(r.receiptsSum),
      balance: num(r.balance),
    });
    return { byReceipts: byReceipts.map(map), byBalance: byBalance.map(map) };
  }
}

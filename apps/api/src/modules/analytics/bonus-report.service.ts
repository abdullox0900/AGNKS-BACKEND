import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { isNetworkWideRole } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { StaffActor } from '@/common/types/actor';

export interface ReportFilter {
  from: Date;
  to: Date;
  /** undefined / empty = every station the actor may see */
  stationIds?: string[];
}

export interface StationBonusRow {
  stationId: string;
  name: string;
  receiptsCount: number;
  receiptsSum: number;
  earned: number;
  pending: number;
  redeemed: number;
  redeemCount: number;
}

export interface ClientBonusRow {
  userId: string;
  name: string;
  phone: string | null;
  earned: number;
  redeemed: number;
  receiptsCount: number;
  redeemCount: number;
  balance: number;
}

export interface BonusOperationRow {
  type: 'earn' | 'spend';
  id: string;
  at: string;
  stationId: string;
  stationName: string;
  clientName: string;
  clientPhone: string | null;
  cashierName: string | null;
  /** earn: purchase amount of the receipt; spend: same as `amount` */
  baseAmount: number;
  /** earn: bonus credited; spend: bonus redeemed */
  amount: number;
  status: string;
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Bonus report: how much bonus clients earned (applied receipts) and how much they redeemed (applied
 * spend operations) per station, per client and as an operation log, plus an Excel export of all of it.
 * Periods are by the moment the bonus was credited / redeemed (created_at). Pending-review receipts are
 * shown separately and not counted as earned; reversed spends are not counted as redeemed.
 */
@Injectable()
export class BonusReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Branch managers are always limited to their own station, whatever they ask for. */
  scope(actor: StaffActor, requested?: string[]): string[] | undefined {
    if (isNetworkWideRole(actor.role)) return requested?.length ? requested : undefined;
    return actor.stationId ? [actor.stationId] : ['__none__'];
  }

  private stationClause(column: string, ids?: string[]) {
    return ids?.length ? Prisma.sql`AND ${Prisma.raw(column)} = ANY(${ids}::text[])` : Prisma.empty;
  }

  async summary(f: ReportFilter) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH r AS (
        SELECT station_id,
               COUNT(*) FILTER (WHERE status = 'applied')::bigint AS cnt,
               COALESCE(SUM(amount) FILTER (WHERE status = 'applied'), 0)::bigint AS base,
               COALESCE(SUM(bonus) FILTER (WHERE status = 'applied'), 0)::bigint AS earned,
               COALESCE(SUM(bonus) FILTER (WHERE status = 'pending_review'), 0)::bigint AS pending
        FROM receipts
        WHERE created_at BETWEEN ${f.from} AND ${f.to}
        GROUP BY station_id
      ), sp AS (
        SELECT station_id, COUNT(*)::bigint AS cnt, COALESCE(SUM(amount), 0)::bigint AS redeemed
        FROM spend_operations
        WHERE status = 'applied' AND created_at BETWEEN ${f.from} AND ${f.to}
        GROUP BY station_id
      )
      SELECT s.id AS "stationId", s.name,
             COALESCE(r.cnt, 0) AS "receiptsCount", COALESCE(r.base, 0) AS "receiptsSum",
             COALESCE(r.earned, 0) AS earned, COALESCE(r.pending, 0) AS pending,
             COALESCE(sp.redeemed, 0) AS redeemed, COALESCE(sp.cnt, 0) AS "redeemCount"
      FROM stations s
      LEFT JOIN r ON r.station_id = s.id
      LEFT JOIN sp ON sp.station_id = s.id
      WHERE TRUE ${this.stationClause('s.id', f.stationIds)}
      ORDER BY COALESCE(r.earned, 0) DESC, s.name
    `;
    const stations: StationBonusRow[] = rows.map((r) => ({
      stationId: String(r.stationId),
      name: String(r.name),
      receiptsCount: num(r.receiptsCount),
      receiptsSum: num(r.receiptsSum),
      earned: num(r.earned),
      pending: num(r.pending),
      redeemed: num(r.redeemed),
      redeemCount: num(r.redeemCount),
    }));
    const totals = stations.reduce(
      (t, s) => ({
        receiptsCount: t.receiptsCount + s.receiptsCount,
        receiptsSum: t.receiptsSum + s.receiptsSum,
        earned: t.earned + s.earned,
        pending: t.pending + s.pending,
        redeemed: t.redeemed + s.redeemed,
        redeemCount: t.redeemCount + s.redeemCount,
      }),
      { receiptsCount: 0, receiptsSum: 0, earned: 0, pending: 0, redeemed: 0, redeemCount: 0 },
    );
    return { stations, totals };
  }

  async clients(f: ReportFilter, opts: { q?: string; limit: number; offset: number }) {
    const like = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH e AS (
        SELECT card_id,
               COALESCE(SUM(bonus) FILTER (WHERE status = 'applied'), 0)::bigint AS earned,
               COUNT(*) FILTER (WHERE status = 'applied')::bigint AS cnt
        FROM receipts
        WHERE created_at BETWEEN ${f.from} AND ${f.to} ${this.stationClause('station_id', f.stationIds)}
        GROUP BY card_id
      ), d AS (
        SELECT card_id, COALESCE(SUM(amount), 0)::bigint AS redeemed, COUNT(*)::bigint AS cnt
        FROM spend_operations
        WHERE status = 'applied' AND created_at BETWEEN ${f.from} AND ${f.to} ${this.stationClause('station_id', f.stationIds)}
        GROUP BY card_id
      )
      SELECT u.id AS "userId", u.first_name AS name, u.phone,
             COALESCE(e.earned, 0) AS earned, COALESCE(d.redeemed, 0) AS redeemed,
             COALESCE(e.cnt, 0) AS "receiptsCount", COALESCE(d.cnt, 0) AS "redeemCount",
             c.cached_balance AS balance, COUNT(*) OVER() AS total
      FROM cards c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN e ON e.card_id = c.id
      LEFT JOIN d ON d.card_id = c.id
      WHERE (e.card_id IS NOT NULL OR d.card_id IS NOT NULL)
        AND (${like}::text IS NULL OR u.first_name ILIKE ${like} OR u.phone ILIKE ${like})
      ORDER BY COALESCE(e.earned, 0) DESC, COALESCE(d.redeemed, 0) DESC, u.first_name
      LIMIT ${opts.limit} OFFSET ${opts.offset}
    `;
    const items: ClientBonusRow[] = rows.map((r) => ({
      userId: String(r.userId),
      name: String(r.name),
      phone: (r.phone as string | null) ?? null,
      earned: num(r.earned),
      redeemed: num(r.redeemed),
      receiptsCount: num(r.receiptsCount),
      redeemCount: num(r.redeemCount),
      balance: num(r.balance),
    }));
    return { items, total: rows.length ? num(rows[0].total) : 0 };
  }

  async operations(f: ReportFilter, opts: { type?: 'earn' | 'spend'; q?: string; limit: number; offset: number }) {
    const like = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
    const type = opts.type ?? null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM (
        SELECT 'earn'::text AS type, r.id, r.created_at AS at, s.id AS "stationId", s.name AS "stationName",
               u.first_name AS "clientName", u.phone AS "clientPhone", NULL::text AS "cashierName",
               r.amount::bigint AS "baseAmount", r.bonus::bigint AS amount, r.status::text AS status
        FROM receipts r
        JOIN stations s ON s.id = r.station_id
        JOIN cards c ON c.id = r.card_id
        JOIN users u ON u.id = c.user_id
        WHERE r.created_at BETWEEN ${f.from} AND ${f.to} AND r.status <> 'rejected' ${this.stationClause('r.station_id', f.stationIds)}
        UNION ALL
        SELECT 'spend'::text, o.id, o.created_at, s.id, s.name,
               u.first_name, u.phone, cu.first_name,
               o.amount::bigint, o.amount::bigint, o.status::text
        FROM spend_operations o
        JOIN stations s ON s.id = o.station_id
        JOIN cards c ON c.id = o.card_id
        JOIN users u ON u.id = c.user_id
        LEFT JOIN users cu ON cu.id = o.cashier_id
        WHERE o.created_at BETWEEN ${f.from} AND ${f.to} ${this.stationClause('o.station_id', f.stationIds)}
      ) x
      WHERE (${type}::text IS NULL OR x.type = ${type})
        AND (${like}::text IS NULL OR x."clientName" ILIKE ${like} OR x."clientPhone" ILIKE ${like})
      ORDER BY x.at DESC
      LIMIT ${opts.limit} OFFSET ${opts.offset}
    `;
    const countRows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT 'earn'::text AS type, u.first_name AS cn, u.phone AS cp
        FROM receipts r JOIN cards c ON c.id = r.card_id JOIN users u ON u.id = c.user_id
        WHERE r.created_at BETWEEN ${f.from} AND ${f.to} AND r.status <> 'rejected' ${this.stationClause('r.station_id', f.stationIds)}
        UNION ALL
        SELECT 'spend'::text, u.first_name, u.phone
        FROM spend_operations o JOIN cards c ON c.id = o.card_id JOIN users u ON u.id = c.user_id
        WHERE o.created_at BETWEEN ${f.from} AND ${f.to} ${this.stationClause('o.station_id', f.stationIds)}
      ) y
      WHERE (${type}::text IS NULL OR y.type = ${type})
        AND (${like}::text IS NULL OR y.cn ILIKE ${like} OR y.cp ILIKE ${like})
    `;
    const items: BonusOperationRow[] = rows.map((r) => ({
      type: r.type as 'earn' | 'spend',
      id: String(r.id),
      at: new Date(r.at as Date).toISOString(),
      stationId: String(r.stationId),
      stationName: String(r.stationName),
      clientName: String(r.clientName),
      clientPhone: (r.clientPhone as string | null) ?? null,
      cashierName: (r.cashierName as string | null) ?? null,
      baseAmount: num(r.baseAmount),
      amount: num(r.amount),
      status: String(r.status),
    }));
    return { items, total: num(countRows[0]?.n) };
  }

  /** Excel workbook: totals per station (with a grand total), per client, and both operation logs. */
  async exportXlsx(f: ReportFilter): Promise<{ buffer: Buffer; filename: string }> {
    const [summary, clients, ops] = await Promise.all([
      this.summary(f),
      this.clients(f, { limit: 100_000, offset: 0 }),
      this.operations(f, { limit: 200_000, offset: 0 }),
    ]);
    const tz = (d: string) => new Date(d).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
    const day = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
    const period = `${day(f.from)} — ${day(f.to)}`;
    const MONEY = '#,##0';

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    const header = (sheet: ExcelJS.Worksheet, row: number, widths: number[]) => {
      const r = sheet.getRow(row);
      r.font = { bold: true };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EEF3' } };
      r.alignment = { vertical: 'middle', wrapText: true };
      widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
      sheet.views = [{ state: 'frozen', ySplit: row }];
    };
    const title = (sheet: ExcelJS.Worksheet, text: string, cols: number) => {
      sheet.mergeCells(1, 1, 1, cols);
      sheet.getCell(1, 1).value = `${text} · ${period}`;
      sheet.getCell(1, 1).font = { bold: true, size: 13 };
    };
    const totalRow = (row: ExcelJS.Row) => {
      row.font = { bold: true };
      row.border = { top: { style: 'thin' } };
    };

    // 1) per station
    const s1 = wb.addWorksheet("Filiallar bo'yicha");
    title(s1, "Bonus hisoboti — filiallar bo'yicha", 8);
    s1.getRow(3).values = ['Filial', 'Cheklar soni', 'Cheklar summasi', 'Olingan bonus', 'Yechilgan bonus', 'Yechimlar soni', 'Farq (olingan − yechilgan)', 'Tekshiruvda (hisobga olinmagan)'];
    header(s1, 3, [38, 14, 18, 18, 18, 14, 22, 22]);
    summary.stations.forEach((s) => s1.addRow([s.name, s.receiptsCount, s.receiptsSum, s.earned, s.redeemed, s.redeemCount, s.earned - s.redeemed, s.pending]));
    const t = summary.totals;
    totalRow(s1.addRow(['JAMI (barcha filiallar)', t.receiptsCount, t.receiptsSum, t.earned, t.redeemed, t.redeemCount, t.earned - t.redeemed, t.pending]));
    [3, 4, 5, 7, 8].forEach((c) => (s1.getColumn(c).numFmt = MONEY));

    // 2) per client
    const s2 = wb.addWorksheet("Mijozlar bo'yicha");
    title(s2, "Bonus hisoboti — mijozlar bo'yicha", 7);
    s2.getRow(3).values = ['Mijoz', 'Telefon', 'Cheklar soni', 'Olingan bonus', 'Yechimlar soni', 'Yechilgan bonus', 'Joriy balans'];
    header(s2, 3, [28, 18, 14, 18, 14, 18, 18]);
    clients.items.forEach((c) => s2.addRow([c.name, c.phone ?? '', c.receiptsCount, c.earned, c.redeemCount, c.redeemed, c.balance]));
    totalRow(
      s2.addRow([
        'JAMI',
        '',
        clients.items.reduce((a, c) => a + c.receiptsCount, 0),
        clients.items.reduce((a, c) => a + c.earned, 0),
        clients.items.reduce((a, c) => a + c.redeemCount, 0),
        clients.items.reduce((a, c) => a + c.redeemed, 0),
        clients.items.reduce((a, c) => a + c.balance, 0),
      ]),
    );
    [4, 6, 7].forEach((c) => (s2.getColumn(c).numFmt = MONEY));

    // 3) earned operations
    const earn = ops.items.filter((o) => o.type === 'earn');
    const s3 = wb.addWorksheet('Olingan bonuslar');
    title(s3, 'Olingan bonuslar (cheklar)', 7);
    s3.getRow(3).values = ['Sana', 'Filial', 'Mijoz', 'Telefon', 'Chek summasi', 'Bonus', 'Holat'];
    header(s3, 3, [20, 34, 26, 18, 16, 14, 18]);
    earn.forEach((o) => s3.addRow([tz(o.at), o.stationName, o.clientName, o.clientPhone ?? '', o.baseAmount, o.amount, o.status === 'applied' ? 'Hisobga tushgan' : 'Tekshiruvda']));
    totalRow(s3.addRow(['JAMI (hisobga tushgan)', '', '', '', earn.filter((o) => o.status === 'applied').reduce((a, o) => a + o.baseAmount, 0), earn.filter((o) => o.status === 'applied').reduce((a, o) => a + o.amount, 0), '']));
    [5, 6].forEach((c) => (s3.getColumn(c).numFmt = MONEY));

    // 4) redeemed operations
    const spend = ops.items.filter((o) => o.type === 'spend');
    const s4 = wb.addWorksheet('Yechilgan bonuslar');
    title(s4, 'Yechilgan bonuslar (kassada ishlatilgan)', 7);
    s4.getRow(3).values = ['Sana', 'Filial', 'Mijoz', 'Telefon', 'Kassir', 'Yechilgan summa', 'Holat'];
    header(s4, 3, [20, 34, 26, 18, 22, 18, 18]);
    spend.forEach((o) => s4.addRow([tz(o.at), o.stationName, o.clientName, o.clientPhone ?? '', o.cashierName ?? '', o.amount, o.status === 'applied' ? 'Amalga oshgan' : 'Bekor qilingan']));
    totalRow(s4.addRow(['JAMI (amalga oshgan)', '', '', '', '', spend.filter((o) => o.status === 'applied').reduce((a, o) => a + o.amount, 0), '']));
    s4.getColumn(6).numFmt = MONEY;

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `bonus-hisobot_${day(f.from)}_${day(f.to)}.xlsx` };
  }
}

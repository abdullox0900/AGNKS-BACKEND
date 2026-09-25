import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SettingsService } from '@/modules/rules/settings.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { tashkentDayRange } from '@/common/lib/tashkent-time';

/** TZ-4 §6.9 — scans every 15 minutes for cashier behavior that warrants a human look. */
@Processor(QUEUE_NAMES.anomalyScan, { concurrency: 1 })
export class AnomalyScanProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const { start, end } = tashkentDayRange();
    await Promise.all([
      this.checkCashierAverages(start, end),
      this.checkRepeatedClientSpends(start, end),
      this.checkDisputeHeavyShifts(),
    ]);
  }

  private async checkCashierAverages(start: Date, end: Date): Promise<void> {
    const multiplier = await this.settings.get('anomaly.cashier_avg_multiplier');

    const perCashier = await this.prisma.$queryRaw<{ cashierId: string; stationId: string; avgAmount: number }[]>`
      SELECT cashier_id AS "cashierId", station_id AS "stationId", AVG(amount)::float AS "avgAmount"
      FROM spend_operations
      WHERE created_at BETWEEN ${start} AND ${end} AND status = 'applied'
      GROUP BY cashier_id, station_id
    `;
    const perStation = await this.prisma.$queryRaw<{ stationId: string; avgAmount: number }[]>`
      SELECT station_id AS "stationId", AVG(amount)::float AS "avgAmount"
      FROM spend_operations
      WHERE created_at BETWEEN ${start} AND ${end} AND status = 'applied'
      GROUP BY station_id
    `;
    const stationAvg = new Map(perStation.map((s) => [s.stationId, s.avgAmount]));

    for (const row of perCashier) {
      const baseline = stationAvg.get(row.stationId);
      if (baseline && row.avgAmount > baseline * multiplier) {
        await this.notifications.enqueue('staff.anomaly', {
          reason: 'cashier_avg_high',
          cashierId: row.cashierId,
          stationId: row.stationId,
          cashierAvg: Math.round(row.avgAmount),
          stationAvg: Math.round(baseline),
        });
      }
    }
  }

  private async checkRepeatedClientSpends(start: Date, end: Date): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ cashierId: string; cardId: string; stationId: string; count: bigint }[]>`
      SELECT cashier_id AS "cashierId", card_id AS "cardId", station_id AS "stationId", COUNT(*)::bigint AS count
      FROM spend_operations
      WHERE created_at BETWEEN ${start} AND ${end} AND status = 'applied'
      GROUP BY cashier_id, card_id, station_id
      HAVING COUNT(*) > 3
    `;
    for (const row of rows) {
      await this.notifications.enqueue('staff.anomaly', {
        reason: 'repeated_client_same_cashier',
        cashierId: row.cashierId,
        cardId: row.cardId,
        stationId: row.stationId,
        count: Number(row.count),
      });
    }
  }

  private async checkDisputeHeavyShifts(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ shiftId: string; stationId: string; count: bigint }[]>`
      SELECT so.shift_id AS "shiftId", so.station_id AS "stationId", COUNT(d.id)::bigint AS count
      FROM disputes d
      JOIN spend_operations so ON so.id = d.ref_id AND d.ref_type = 'spend'
      GROUP BY so.shift_id, so.station_id
      HAVING COUNT(d.id) > 2
    `;
    for (const row of rows) {
      await this.notifications.enqueue('staff.anomaly', {
        reason: 'shift_multiple_disputes',
        shiftId: row.shiftId,
        stationId: row.stationId,
        count: Number(row.count),
      });
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { tashkentDayRange } from '@/common/lib/tashkent-time';

/**
 * Every evening (21:00 Tashkent): tell each cashier who has a linked Telegram how much bonus they redeemed
 * today. Cashiers with nothing redeemed get no message. This is the only thing the staff bot sends.
 */
@Processor(QUEUE_NAMES.reportDaily, { concurrency: 1 })
export class ReportDailyProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportDailyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const { start, end } = tashkentDayRange(new Date());
    const rows = await this.prisma.$queryRaw<{ tg: bigint; amount: bigint; count: bigint }[]>`
      SELECT u.tg_user_id AS tg, COALESCE(SUM(o.amount), 0)::bigint AS amount, COUNT(o.id)::bigint AS count
      FROM spend_operations o
      JOIN users u ON u.id = o.cashier_id
      WHERE o.status = 'applied' AND o.created_at >= ${start} AND o.created_at < ${end} AND u.tg_user_id IS NOT NULL
      GROUP BY u.tg_user_id
      HAVING COALESCE(SUM(o.amount), 0) > 0
    `;
    for (const r of rows) {
      await this.notifications.enqueue('staff.cashier_daily', { tgUserId: Number(r.tg), amount: r.amount.toString(), count: Number(r.count) });
    }
    this.logger.log(`cashier daily summaries queued: ${rows.length}`);
  }
}

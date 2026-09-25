import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AnalyticsService } from '@/modules/analytics/analytics.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { tashkentDayRange } from '@/common/lib/tashkent-time';

@Processor(QUEUE_NAMES.reportDaily, { concurrency: 1 })
export class ReportDailyProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { start, end } = tashkentDayRange(yesterday);

    const network = await this.analytics.overview({ from: start, to: end });
    await this.notifications.enqueue('staff.daily_report', { scope: 'network', ...network });

    const stations = await this.prisma.station.findMany({ where: { status: 'active' } });
    for (const station of stations) {
      const stats = await this.analytics.overview({ from: start, to: end, stationIds: [station.id] });
      await this.notifications.enqueue('staff.daily_report', { scope: 'station', stationId: station.id, ...stats });
    }
  }
}

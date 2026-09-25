import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';

@Processor(QUEUE_NAMES.analyticsRefresh, { concurrency: 1 })
export class AnalyticsRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsRefreshProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_station_stats');
    } catch (err) {
      // The view may not exist yet on a fresh DB before its migration runs — analytics
      // endpoints compute live aggregates anyway, so a missed refresh is not user-visible.
      this.logger.warn(`daily_station_stats refresh skipped: ${(err as Error).message}`);
    }
  }
}

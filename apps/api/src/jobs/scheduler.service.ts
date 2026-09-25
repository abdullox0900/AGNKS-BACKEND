import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';

const TZ = 'Asia/Tashkent';

/**
 * Registers every recurring job's repeat schedule once at boot. BullMQ
 * dedupes repeatable jobs by their (name, pattern, tz) key, so re-running
 * this on every deploy is safe — it won't create duplicate schedules.
 */
@Injectable()
export class JobsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(JobsSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.outbox) private readonly outboxQueue: Queue,
    @InjectQueue(QUEUE_NAMES.shiftForgotten) private readonly shiftForgottenQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ledgerReconcile) private readonly ledgerReconcileQueue: Queue,
    @InjectQueue(QUEUE_NAMES.bonusExpire) private readonly bonusExpireQueue: Queue,
    @InjectQueue(QUEUE_NAMES.analyticsRefresh) private readonly analyticsRefreshQueue: Queue,
    @InjectQueue(QUEUE_NAMES.reportDaily) private readonly reportDailyQueue: Queue,
    @InjectQueue(QUEUE_NAMES.anomalyScan) private readonly anomalyScanQueue: Queue,
    @InjectQueue(QUEUE_NAMES.photosCleanup) private readonly photosCleanupQueue: Queue,
    @InjectQueue(QUEUE_NAMES.idempotencyCleanup) private readonly idempotencyCleanupQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.outboxQueue.add('poll', {}, { repeat: { every: 1000 }, jobId: 'outbox-poll' }),
      this.shiftForgottenQueue.add('scan', {}, { repeat: { pattern: '0 * * * *', tz: TZ }, jobId: 'shift-forgotten' }),
      this.ledgerReconcileQueue.add('reconcile', {}, { repeat: { pattern: '0 2 * * *', tz: TZ }, jobId: 'ledger-reconcile' }),
      this.bonusExpireQueue.add('expire', {}, { repeat: { pattern: '0 3 * * *', tz: TZ }, jobId: 'bonus-expire' }),
      this.analyticsRefreshQueue.add('refresh', {}, { repeat: { every: 10 * 60_000 }, jobId: 'analytics-refresh' }),
      this.reportDailyQueue.add('report', {}, { repeat: { pattern: '0 21 * * *', tz: TZ }, jobId: 'report-daily' }),
      this.anomalyScanQueue.add('scan', {}, { repeat: { every: 15 * 60_000 }, jobId: 'anomaly-scan' }),
      this.photosCleanupQueue.add('cleanup', {}, { repeat: { pattern: '30 3 * * *', tz: TZ }, jobId: 'photos-cleanup' }),
      this.idempotencyCleanupQueue.add('cleanup', {}, { repeat: { pattern: '45 3 * * *', tz: TZ }, jobId: 'idempotency-cleanup' }),
    ]);
    this.logger.log('Recurring job schedules registered');
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Processor(QUEUE_NAMES.ledgerReconcile, { concurrency: 1 })
export class LedgerReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(LedgerReconcileProcessor.name);

  constructor(
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const drift = await this.ledger.findDrift();
    if (drift.length === 0) return;

    this.logger.error(`Ledger drift detected on ${drift.length} card(s): ${JSON.stringify(drift).slice(0, 2000)}`);
    await this.notifications.enqueue('staff.anomaly', {
      reason: 'ledger_drift',
      affectedCards: drift.length,
    });
  }
}

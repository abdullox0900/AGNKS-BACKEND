import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { AutoReviewService } from '@/modules/receipts/auto-review.service';

/** Every minute: when Avto-tekshiruv is on, re-asks soliq.uz about receipts that have waited long enough. */
@Processor(QUEUE_NAMES.receiptAutoReview, { concurrency: 1 })
export class ReceiptAutoReviewProcessor extends WorkerHost {
  constructor(private readonly autoReview: AutoReviewService) {
    super();
  }

  async process(): Promise<void> {
    await this.autoReview.runDue();
  }
}

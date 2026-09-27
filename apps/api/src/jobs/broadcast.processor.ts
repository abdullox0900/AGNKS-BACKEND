import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { BroadcastsService } from '@/modules/broadcasts/broadcasts.service';

/** Every 30s: turns due dashboard broadcasts into per-recipient outbox rows. */
@Processor(QUEUE_NAMES.broadcastDispatch, { concurrency: 1 })
export class BroadcastDispatchProcessor extends WorkerHost {
  constructor(private readonly broadcasts: BroadcastsService) {
    super();
  }

  async process(): Promise<void> {
    await this.broadcasts.dispatchDue();
  }
}

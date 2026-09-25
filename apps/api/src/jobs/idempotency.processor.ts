import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

@Processor(QUEUE_NAMES.idempotencyCleanup, { concurrency: 1 })
export class IdempotencyCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(IdempotencyCleanupProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - MAX_AGE_MS) } },
    });
    if (count > 0) this.logger.log(`Deleted ${count} expired idempotency key(s)`);
  }
}

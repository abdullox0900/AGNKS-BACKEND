import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { StorageService } from '@/infra/storage/storage.service';

const BATCH_SIZE = 200;

@Processor(QUEUE_NAMES.photosCleanup, { concurrency: 1 })
export class PhotosCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(PhotosCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const expired = await this.prisma.receiptPhoto.findMany({
      where: { deleteAfter: { lt: new Date() } },
      take: BATCH_SIZE,
    });

    for (const photo of expired) {
      await this.storage.delete(photo.storageKey);
      await this.prisma.receiptPhoto.delete({ where: { id: photo.id } }).catch(() => undefined);
    }
    if (expired.length > 0) this.logger.log(`Deleted ${expired.length} expired receipt photo(s)`);
  }
}

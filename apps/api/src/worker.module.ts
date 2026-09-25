import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { TelegramModule } from '@/infra/telegram/telegram.module';
import { StorageModule } from '@/infra/storage/storage.module';
import { QueueModule } from '@/infra/queue/queue.module';
import { JobsModule } from '@/jobs/jobs.module';

/**
 * The background-job process. Deployed and run separately from the HTTP API
 * (see docker/ecosystem.config.cjs) so a stuck or crashing job worker can
 * never take client/cashier/dashboard traffic down with it, and vice versa.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    TelegramModule,
    StorageModule,
    QueueModule,
    JobsModule,
  ],
})
export class WorkerModule {}

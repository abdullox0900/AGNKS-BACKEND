import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379')).hostname,
          port: Number(new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379')).port || 6379),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      }),
    }),
    BullModule.registerQueue(...Object.values(QUEUE_NAMES).map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}

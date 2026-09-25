import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { installBigIntJsonSupport, installProcessGuards } from './bootstrap-common';

async function bootstrap() {
  installBigIntJsonSupport();
  const logger = new Logger('Worker');
  installProcessGuards(logger);

  await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  logger.log('Worker started — processing background jobs');
}

bootstrap();

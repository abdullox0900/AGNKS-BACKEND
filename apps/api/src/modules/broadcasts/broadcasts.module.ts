import { Module } from '@nestjs/common';
import { AuditModule } from '@/modules/audit/audit.module';
import { BroadcastsService } from './broadcasts.service';
import { AdminBroadcastsController, ClientNewsController } from './broadcasts.controller';

/** Service only — also imported by the worker process (no HTTP controllers there). */
@Module({
  imports: [AuditModule],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsCoreModule {}

@Module({
  imports: [BroadcastsCoreModule],
  controllers: [AdminBroadcastsController, ClientNewsController],
  exports: [BroadcastsCoreModule],
})
export class BroadcastsModule {}

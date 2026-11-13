import { Module } from '@nestjs/common';
import { AuditModule } from '@/modules/audit/audit.module';
import { FaceidClient } from './faceid.client';
import { FaceidController } from './faceid.controller';
import { FaceidService } from './faceid.service';

@Module({
  imports: [AuditModule],
  controllers: [FaceidController],
  providers: [FaceidClient, FaceidService],
})
export class FaceidModule {}

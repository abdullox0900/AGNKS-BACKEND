import { Module } from '@nestjs/common';
import { AuditModule } from '@/modules/audit/audit.module';
import { ChangelogController } from './changelog.controller';
import { ChangelogService } from './changelog.service';

@Module({
  imports: [AuditModule],
  controllers: [ChangelogController],
  providers: [ChangelogService],
})
export class ChangelogModule {}

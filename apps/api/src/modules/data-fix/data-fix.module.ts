import { Module } from '@nestjs/common';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { DataFixController } from './data-fix.controller';
import { DataFixService } from './data-fix.service';
import { DataFixGateService } from './data-fix-gate.service';
import { DataFixUnlockedGuard } from './data-fix-unlocked.guard';
import { AuditModule } from '@/modules/audit/audit.module';

@Module({
  imports: [LedgerModule, AuditModule],
  controllers: [DataFixController],
  providers: [DataFixService, DataFixGateService, DataFixUnlockedGuard],
})
export class DataFixModule {}

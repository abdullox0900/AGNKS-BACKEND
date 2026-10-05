import { Module } from '@nestjs/common';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { DataFixController } from './data-fix.controller';
import { DataFixService } from './data-fix.service';

@Module({
  imports: [LedgerModule],
  controllers: [DataFixController],
  providers: [DataFixService],
})
export class DataFixModule {}

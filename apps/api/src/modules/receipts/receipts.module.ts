import { AdminLargeReceiptsController } from './admin-large-receipts.controller';
import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { SoliqFetchService } from './soliq-fetch.service';
import { HistoryService } from './history.service';
import { ReceiptsController } from './receipts.controller';
import { AdminReviewController } from './admin-review.controller';
import { AdminClientReceiptController } from './admin-client-receipt.controller';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AuditModule } from '@/modules/audit/audit.module';

@Module({
  imports: [LedgerModule, RulesModule, NotificationsModule, AuthModule, AuditModule],
  controllers: [ReceiptsController, AdminReviewController, AdminLargeReceiptsController, AdminClientReceiptController],
  providers: [ReceiptsService, SoliqFetchService, HistoryService],
  exports: [ReceiptsService, HistoryService],
})
export class ReceiptsModule {}

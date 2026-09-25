import { Module } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';
import { ShiftForgottenProcessor } from './shift.processor';
import { LedgerReconcileProcessor } from './ledger.processor';
import { BonusExpireProcessor } from './bonus.processor';
import { AnalyticsRefreshProcessor } from './analytics.processor';
import { ReportDailyProcessor } from './report.processor';
import { AnomalyScanProcessor } from './anomaly.processor';
import { PhotosCleanupProcessor } from './photos.processor';
import { IdempotencyCleanupProcessor } from './idempotency.processor';
import { JobsSchedulerService } from './scheduler.service';
import { ShiftsModule } from '@/modules/shifts/shifts.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';

@Module({
  imports: [ShiftsModule, LedgerModule, RulesModule, NotificationsModule, AnalyticsModule],
  providers: [
    OutboxProcessor,
    ShiftForgottenProcessor,
    LedgerReconcileProcessor,
    BonusExpireProcessor,
    AnalyticsRefreshProcessor,
    ReportDailyProcessor,
    AnomalyScanProcessor,
    PhotosCleanupProcessor,
    IdempotencyCleanupProcessor,
    JobsSchedulerService,
  ],
})
export class JobsModule {}

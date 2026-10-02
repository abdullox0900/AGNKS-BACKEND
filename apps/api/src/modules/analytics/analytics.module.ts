import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ExportService } from './export.service';
import { AnalyticsController } from './analytics.controller';
import { BonusReportController } from './bonus-report.controller';
import { BonusReportService } from './bonus-report.service';

@Module({
  controllers: [AnalyticsController, BonusReportController],
  providers: [AnalyticsService, ExportService, BonusReportService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

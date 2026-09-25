import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ExportService } from './export.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ExportService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

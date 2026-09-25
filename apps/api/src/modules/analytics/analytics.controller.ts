import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, analyticsMetricSchema, type AnalyticsMetric } from '@agnks/types';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationScopeGuard } from '@/common/guards/station-scope.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { ExportService } from './export.service';

@Controller('admin')
@UseGuards(StaffAuthGuard, RolesGuard, StationScopeGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exportService: ExportService,
  ) {}

  @Get('overview')
  overview(@Query('from') from: string, @Query('to') to: string, @Query('stationIds') stationIds?: string | string[]) {
    return this.analytics.overview({ from: new Date(from), to: new Date(to), stationIds: toArray(stationIds) });
  }

  @Get('alerts')
  alerts(@Query('stationIds') stationIds?: string | string[]) {
    return this.analytics.alerts(toArray(stationIds));
  }

  @Get('analytics/:metric')
  series(
    @Param('metric') metric: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('stationIds') stationIds?: string | string[],
    @Query('granularity') granularity: 'day' | 'week' | 'month' = 'day',
  ) {
    const parsedMetric = analyticsMetricSchema.parse(metric);
    return this.analytics.series(
      parsedMetric,
      { from: new Date(from), to: new Date(to), stationIds: toArray(stationIds) },
      granularity,
    );
  }

  @Get('analytics/:metric/export')
  async export(
    @Param('metric') metric: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('stationIds') stationIds: string | string[] | undefined,
    @Query('granularity') granularity: 'day' | 'week' | 'month' = 'day',
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const parsedMetric: AnalyticsMetric = analyticsMetricSchema.parse(metric);
    const data = await this.analytics.series(
      parsedMetric,
      { from: new Date(from), to: new Date(to), stationIds: toArray(stationIds) },
      granularity,
    );
    if (!Array.isArray(data)) throw new AppError('VALIDATION_ERROR', { message: 'metric does not support export' });

    const file = await this.exportService.toFile(data as Record<string, unknown>[], parsedMetric, format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }
}

function toArray(value?: string | string[]): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

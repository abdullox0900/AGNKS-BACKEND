import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '@agnks/types';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationScopeGuard } from '@/common/guards/station-scope.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { BonusReportService, type ReportFilter } from './bonus-report.service';

/** "Bonus hisoboti": earned vs redeemed bonus per station / client / operation, with an Excel export. */
@Controller('admin/bonus-report')
@UseGuards(StaffAuthGuard, RolesGuard, StationScopeGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class BonusReportController {
  constructor(private readonly report: BonusReportService) {}

  private filter(actor: StaffActor, from: string, to: string, stationIds?: string | string[]): ReportFilter {
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new AppError('VALIDATION_ERROR', { message: 'from/to must be ISO dates' });
    const ids = stationIds ? (Array.isArray(stationIds) ? stationIds : [stationIds]) : undefined;
    return { from: f, to: t, stationIds: this.report.scope(actor, ids) };
  }

  @Get('summary')
  summary(@CurrentStaff() actor: StaffActor, @Query('from') from: string, @Query('to') to: string, @Query('stationIds') stationIds?: string | string[]) {
    return this.report.summary(this.filter(actor, from, to, stationIds));
  }

  @Get('clients')
  clients(
    @CurrentStaff() actor: StaffActor,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('stationIds') stationIds?: string | string[],
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.report.clients(this.filter(actor, from, to, stationIds), { q, limit: clamp(limit, 50, 200), offset: clamp(offset, 0, 1_000_000) });
  }

  @Get('operations')
  operations(
    @CurrentStaff() actor: StaffActor,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('stationIds') stationIds?: string | string[],
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.report.operations(this.filter(actor, from, to, stationIds), {
      type: type === 'earn' || type === 'spend' ? type : undefined,
      q,
      limit: clamp(limit, 50, 200),
      offset: clamp(offset, 0, 1_000_000),
    });
  }

  @Get('export')
  async export(@CurrentStaff() actor: StaffActor, @Res() res: Response, @Query('from') from: string, @Query('to') to: string, @Query('stationIds') stationIds?: string | string[]) {
    const file = await this.report.exportXlsx(this.filter(actor, from, to, stationIds));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }
}

function clamp(raw: string | undefined, fallback: number, max = 200): number {
  const n = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : fallback;
}

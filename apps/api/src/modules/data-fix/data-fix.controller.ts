import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { DataFixService, type RecordKind } from './data-fix.service';

const refs = z.array(z.object({ kind: z.enum(['receipt', 'spend', 'adjust']), id: z.string().min(1).max(64) })).min(1).max(500);
const previewSchema = z.object({ items: refs });
const deleteSchema = z.object({ items: refs, password: z.string().min(1).max(200), note: z.string().trim().min(3).max(500) });

/** Correct test / mistaken data. SEO only; every deletion needs the SEO's own password. */
@Controller('admin/data-fix')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('seo')
export class DataFixController {
  constructor(private readonly fix: DataFixService) {}

  @Get('records')
  records(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('stationIds') stationIds?: string | string[],
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new AppError('VALIDATION_ERROR', { message: 'from/to must be ISO dates' });
    const clamp = (raw: string | undefined, d: number, max: number) => {
      const n = raw === undefined ? d : Number(raw);
      return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : d;
    };
    return this.fix.list({
      from: f,
      to: t,
      stationIds: stationIds ? (Array.isArray(stationIds) ? stationIds : [stationIds]) : undefined,
      kind: kind === 'receipt' || kind === 'spend' || kind === 'adjust' ? (kind as RecordKind) : undefined,
      q,
      limit: clamp(limit, 50, 200),
      offset: clamp(offset, 0, 1_000_000),
    });
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodValidationPipe(previewSchema)) dto: z.infer<typeof previewSchema>) {
    return this.fix.preview(dto.items);
  }

  @Post('delete')
  @HttpCode(200)
  remove(@Body(new ZodValidationPipe(deleteSchema)) dto: z.infer<typeof deleteSchema>, @CurrentStaff() actor: StaffActor) {
    return this.fix.remove(dto.items, { password: dto.password, note: dto.note }, actor);
  }
}

import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { FaceidService } from './faceid.service';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const noteSchema = z.object({
  employeeId: z.string().min(1).max(64),
  date: z.string().regex(dateRe),
  reason: z.enum(['sick', 'leave', 'none', 'trip', 'other']).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});
type NoteDto = z.infer<typeof noteSchema>;

const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const date = (v: string | undefined, fallback = today()) => {
  const d = v ?? fallback;
  if (!dateRe.test(d)) throw new AppError('VALIDATION_ERROR', { reason: 'bad_date' });
  return d;
};

/**
 * FaceID (attendance from TimeFace terminals). Seo and root_admin only for now — a branch manager
 * would need TimeFace branches tied to stations first. root_admin is view-only (RolesGuard).
 */
@Controller('admin/faceid')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('root_admin', 'seo')
export class FaceidController {
  constructor(private readonly faceid: FaceidService) {}

  @Get('status')
  status() {
    return this.faceid.status();
  }

  @Get('branches')
  branches() {
    return this.faceid.branches();
  }

  @Get('employees')
  employees() {
    return this.faceid.employees();
  }

  @Get('day')
  day(@Query('date') d?: string) {
    return this.faceid.day(date(d));
  }

  @Get('range')
  range(@Query('from') from?: string, @Query('to') to?: string) {
    return this.faceid.range(date(from), date(to));
  }

  @Get('events')
  events(@Query('date') d?: string) {
    return this.faceid.events(date(d));
  }

  @Put('notes')
  @Roles('seo')
  saveNote(@Body(new ZodValidationPipe(noteSchema)) dto: NoteDto, @CurrentStaff() actor: StaffActor) {
    return this.faceid.saveNote(actor.userId, dto);
  }
}

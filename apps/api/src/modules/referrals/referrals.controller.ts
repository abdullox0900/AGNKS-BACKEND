import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  createAttendantSchema,
  referralAnswerSchema,
  referralSettingsSchema,
  updateAttendantSchema,
  type CreateAttendantDto,
  type ReferralAnswerDto,
  type ReferralSettingsDto,
  type UpdateAttendantDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentClient, CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { ClientActor, StaffActor } from '@/common/types/actor';
import { ReferralsService } from './referrals.service';

const toArray = (v?: string | string[]) => (v === undefined ? undefined : Array.isArray(v) ? v : v.split(',').filter(Boolean));

/** What a client sees: the list to pick from and the answer. */
@Controller('me/referral')
@UseGuards(ClientAuthGuard)
export class ClientReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('options')
  options() {
    return this.referrals.optionsForClient();
  }

  @Post()
  answer(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(referralAnswerSchema)) dto: ReferralAnswerDto) {
    return this.referrals.answer(actor.userId, dto);
  }
}

/** Dashboard: the roster, the ranking and the on/off switch. Everyone on the dashboard reads; only the SEO changes. */
@Controller('admin')
@UseGuards(StaffAuthGuard, RolesGuard)
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('attendants')
  @Roles('branch_manager', 'root_admin', 'seo')
  list(@CurrentStaff() actor: StaffActor, @Query('stationIds') stationIds?: string | string[]) {
    return this.referrals.listAttendants(actor, toArray(stationIds));
  }

  @Post('attendants')
  @Roles('seo')
  create(@Body(new ZodValidationPipe(createAttendantSchema)) dto: CreateAttendantDto, @CurrentStaff() actor: StaffActor) {
    return this.referrals.createAttendant(dto, actor.userId);
  }

  @Patch('attendants/:id')
  @Roles('seo')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateAttendantSchema)) dto: UpdateAttendantDto, @CurrentStaff() actor: StaffActor) {
    return this.referrals.updateAttendant(id, dto, actor.userId);
  }

  @Delete('attendants/:id')
  @Roles('seo')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.referrals.removeAttendant(id, actor.userId);
  }

  @Get('referrals/summary')
  @Roles('branch_manager', 'root_admin', 'seo')
  summary(@CurrentStaff() actor: StaffActor, @Query('from') from: string, @Query('to') to: string, @Query('stationIds') stationIds?: string | string[]) {
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new BadRequestException('invalid period');
    return this.referrals.summary(actor, f, t, toArray(stationIds));
  }

  @Get('referrals/settings')
  @Roles('branch_manager', 'root_admin', 'seo')
  getSettings() {
    return this.referrals.getSettings();
  }

  @Put('referrals/settings')
  @Roles('seo')
  putSettings(@Body(new ZodValidationPipe(referralSettingsSchema)) dto: ReferralSettingsDto, @CurrentStaff() actor: StaffActor) {
    return this.referrals.updateSettings(dto, actor.userId);
  }
}

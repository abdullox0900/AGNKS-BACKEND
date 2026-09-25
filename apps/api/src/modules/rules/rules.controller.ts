import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  createPromotionSchema,
  impactPreviewSchema,
  setBaseRateSchema,
  settingValueSchema,
  SETTING_KEYS,
  settingsSchemas,
  type CreatePromotionDto,
  type ImpactPreviewDto,
  type SetBaseRateDto,
  type SettingKey,
  type PromotionStatus,
} from '@agnks/types';
import { AppError } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import type { StaffActor } from '@/common/types/actor';
import { SettingsService } from './settings.service';
import { PromotionsService } from './promotions.service';

@Controller('admin')
@UseGuards(StaffAuthGuard, RolesGuard)
export class RulesController {
  constructor(
    private readonly settings: SettingsService,
    private readonly promotions: PromotionsService,
  ) {}

  @Get('bonus/settings')
  @Roles('branch_manager', 'root_admin', 'seo')
  async getBonusSettings() {
    return { baseRateBps: await this.settings.get('bonus.base_rate_bps') };
  }

  @Put('bonus/base-rate')
  @Roles('root_admin', 'seo')
  async setBaseRate(
    @Body(new ZodValidationPipe(setBaseRateSchema)) dto: SetBaseRateDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    await this.settings.set('bonus.base_rate_bps', dto.rateBps, actor.userId);
    return { baseRateBps: dto.rateBps };
  }

  @Get('promotions')
  @Roles('branch_manager', 'root_admin', 'seo')
  listPromotions(@Query('status') status?: PromotionStatus) {
    return this.promotions.list(status);
  }

  @Post('promotions')
  @Roles('root_admin', 'seo')
  createPromotion(
    @Body(new ZodValidationPipe(createPromotionSchema)) dto: CreatePromotionDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.promotions.create({
      name: dto.name,
      rateBps: dto.rateBps,
      stationIds: dto.stationIds,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      reason: dto.reason,
      createdBy: actor.userId,
    });
  }

  @Post('promotions/:id/cancel')
  @Roles('root_admin', 'seo')
  cancelPromotion(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.promotions.cancel(id, actor.userId);
  }

  @Post('bonus/impact-preview')
  @Roles('root_admin', 'seo')
  impactPreview(@Body(new ZodValidationPipe(impactPreviewSchema)) dto: ImpactPreviewDto) {
    return this.promotions.impactPreview(dto.rateBps, dto.stationIds);
  }

  @Get('settings')
  @Roles('root_admin', 'seo')
  async getSettings() {
    return this.settings.getAll();
  }

  @Put('settings/:key')
  @Roles('root_admin', 'seo')
  async putSetting(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(settingValueSchema)) dto: { value: unknown },
    @CurrentStaff() actor: StaffActor,
  ) {
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      throw new AppError('VALIDATION_ERROR', { message: `Unknown setting key: ${key}` });
    }
    const typedKey = key as SettingKey;
    settingsSchemas[typedKey].parse(dto.value);
    await this.settings.set(typedKey, dto.value, actor.userId);
    return { key: typedKey, value: dto.value };
  }
}

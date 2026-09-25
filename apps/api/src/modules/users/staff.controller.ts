import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  createStaffSchema,
  updateStaffSchema,
  removeStaffSchema,
  type CreateStaffDto,
  type RemoveStaffDto,
  type StaffRole,
  type UpdateStaffDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import type { StaffActor } from '@/common/types/actor';
import { StaffService } from './staff.service';

@Controller('admin/staff')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentStaff() actor: StaffActor, @Query('role') role?: StaffRole, @Query('stationId') stationId?: string) {
    return this.staff.list(actor, role, stationId);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createStaffSchema)) dto: CreateStaffDto, @CurrentStaff() actor: StaffActor) {
    return this.staff.create(dto, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffSchema)) dto: UpdateStaffDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.staff.update(id, dto, actor);
  }

  @Post(':id/reset-pin')
  resetPin(@Param('id') id: string, @Body() body: { pin?: string }, @CurrentStaff() actor: StaffActor) {
    return this.staff.resetPin(id, actor, body?.pin);
  }

  @Post(':id/regenerate-recovery-code')
  regenerateRecoveryCode(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.staff.regenerateRecoveryCode(id, actor);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(removeStaffSchema)) dto: RemoveStaffDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.staff.remove(id, actor, dto.password);
  }
}

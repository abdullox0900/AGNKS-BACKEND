import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createStationSchema,
  createTerminalSchema,
  updateStationSchema,
  updateTerminalSchema,
  type CreateStationDto,
  type CreateTerminalDto,
  type UpdateStationDto,
  type UpdateTerminalDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import type { StaffActor } from '@/common/types/actor';
import { StationsService } from './stations.service';

@Controller()
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get('stations')
  listPublic() {
    return this.stations.listActive();
  }

  @Get('admin/stations')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('branch_manager', 'root_admin', 'seo')
  listAdmin() {
    return this.stations.listAll();
  }

  @Post('admin/stations')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('root_admin', 'seo')
  create(@Body(new ZodValidationPipe(createStationSchema)) dto: CreateStationDto, @CurrentStaff() actor: StaffActor) {
    return this.stations.create(dto, actor.userId);
  }

  @Patch('admin/stations/:id')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('seo')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStationSchema)) dto: UpdateStationDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.stations.update(id, dto, actor.userId);
  }

  @Delete('admin/stations/:id')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('seo')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.stations.remove(id, actor.userId);
  }

  @Get('admin/stations/:id/terminals')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('branch_manager', 'root_admin', 'seo')
  listTerminals(@Param('id') id: string) {
    return this.stations.listTerminals(id);
  }

  @Post('admin/stations/:id/terminals')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('root_admin', 'seo')
  createTerminal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createTerminalSchema)) dto: CreateTerminalDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.stations.createTerminal(id, dto, actor.userId);
  }

  @Delete('admin/terminals/:id')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('seo')
  removeTerminal(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.stations.removeTerminal(id, actor.userId);
  }

  @Patch('admin/terminals/:id')
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('root_admin', 'seo')
  updateTerminal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTerminalSchema)) dto: UpdateTerminalDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.stations.updateTerminal(id, dto, actor.userId);
  }
}

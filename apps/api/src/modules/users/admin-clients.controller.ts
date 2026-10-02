import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { adjustClientSchema, renameClientSchema, type AdjustClientDto, type RenameClientDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { AdminClientsService } from './admin-clients.service';

@Controller('admin/clients')
@UseGuards(StaffAuthGuard, RolesGuard)
export class AdminClientsController {
  constructor(private readonly clients: AdminClientsService) {}

  @Get()
  @Roles('branch_manager', 'root_admin', 'seo')
  search(@Query('q') q?: string, @Query('cursor') cursor?: string) {
    return this.clients.search(q, cursor);
  }

  @Get(':id')
  @Roles('branch_manager', 'root_admin', 'seo')
  detail(@Param('id') id: string) {
    return this.clients.detail(id);
  }

  @Get(':id/history')
  @Roles('branch_manager', 'root_admin', 'seo')
  history(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    const kind = type === 'receipt' || type === 'spend' || type === 'adjust' ? type : undefined;
    return this.clients.history(id, { cursor, limit: limit ? Number(limit) : undefined, type: kind });
  }

  @Patch(':id')
  @Roles('seo')
  rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameClientSchema)) dto: RenameClientDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.clients.rename(id, dto.firstName, actor.userId);
  }

  @Post(':id/adjust')
  @Roles('seo')
  adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustClientSchema)) dto: AdjustClientDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.clients.adjust(id, dto.delta, dto.note, actor.userId);
  }

  @Post(':id/block')
  @Roles('seo')
  block(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.clients.setBlocked(id, true, actor.userId);
  }

  @Post(':id/unblock')
  @Roles('seo')
  unblock(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.clients.setBlocked(id, false, actor.userId);
  }
}

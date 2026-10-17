import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { adjustClientSchema, blockClientSchema, renameClientSchema, type AdjustClientDto, type BlockClientDto, type RenameClientDto } from '@agnks/types';
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
  search(@Query('q') q?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.clients.search(q, cursor, limit ? Math.min(Math.max(Number(limit) || 20, 1), 200) : 20);
  }

  /** Numbered pages for the Mijozlar page: `?page=1&pageSize=40&sort=balance|seen|registered&filter=recent|frequent&q=`. */
  @Get('page')
  @Roles('branch_manager', 'root_admin', 'seo')
  listPage(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('filter') filter?: string,
  ) {
    return this.clients.page({
      q: q || undefined,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 40,
      sort: sort === 'seen' || sort === 'registered' ? sort : 'balance',
      filter: filter === 'recent' || filter === 'frequent' ? filter : undefined,
    });
  }

  @Get('stats')
  @Roles('branch_manager', 'root_admin', 'seo')
  stats() {
    return this.clients.stats();
  }

  // root_admin may browse the list but not open a client (balance, history, receipts) — view-only role.
  @Get(':id')
  @Roles('branch_manager', 'seo')
  detail(@Param('id') id: string) {
    return this.clients.detail(id);
  }

  @Get(':id/history')
  @Roles('branch_manager', 'seo')
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
  block(@Param('id') id: string, @Body(new ZodValidationPipe(blockClientSchema)) dto: BlockClientDto, @CurrentStaff() actor: StaffActor) {
    return this.clients.setBlocked(id, true, actor.userId, dto.reason);
  }

  @Post(':id/unblock')
  @Roles('seo')
  unblock(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.clients.setBlocked(id, false, actor.userId);
  }
}

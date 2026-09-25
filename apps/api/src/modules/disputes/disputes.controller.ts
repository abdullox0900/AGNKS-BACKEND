import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { disputeCreateSchema, resolveDisputeSchema, type DisputeCreateDto, type ResolveDisputeDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentClient, CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { ClientActor, StaffActor } from '@/common/types/actor';
import { DisputesService } from './disputes.service';

@Controller('me/disputes')
@UseGuards(ClientAuthGuard)
export class ClientDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  create(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(disputeCreateSchema)) dto: DisputeCreateDto) {
    return this.disputes.create(actor.cardId, dto);
  }

  @Get()
  list(@CurrentClient() actor: ClientActor) {
    return this.disputes.listMine(actor.cardId);
  }
}

@Controller('admin/disputes')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.disputes.adminList(status, cursor);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.disputes.adminDetail(id);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) dto: ResolveDisputeDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.disputes.resolve(id, actor.userId, dto);
  }
}

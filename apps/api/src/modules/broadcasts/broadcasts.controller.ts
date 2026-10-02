import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { createBroadcastSchema, type CreateBroadcastDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import type { StaffActor } from '@/common/types/actor';
import { BroadcastsService } from './broadcasts.service';

@Controller('admin/broadcasts')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('root_admin', 'seo')
export class AdminBroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  list() {
    return this.broadcasts.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createBroadcastSchema)) dto: CreateBroadcastDto, @CurrentStaff() actor: StaffActor) {
    return this.broadcasts.create({
      textUz: dto.textUz,
      textRu: dto.textRu,
      sendAt: dto.sendAt ? new Date(dto.sendAt) : null,
      createdBy: actor.userId,
    });
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.broadcasts.cancel(id, actor.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.broadcasts.remove(id, actor.userId);
  }
}

/** Webapp "Xabarlar" feed — every sent broadcast, whatever the client's promo toggle. */
@Controller('me')
@UseGuards(ClientAuthGuard)
export class ClientNewsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get('news')
  news() {
    return this.broadcasts.news();
  }
}

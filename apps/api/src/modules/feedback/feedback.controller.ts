import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  feedbackCreateSchema,
  resolveFeedbackSchema,
  type FeedbackCreateDto,
  type ResolveFeedbackDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentClient, CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { ClientActor, StaffActor } from '@/common/types/actor';
import { FeedbackService } from './feedback.service';

@Controller('me/feedback')
@UseGuards(ClientAuthGuard)
export class ClientFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  create(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(feedbackCreateSchema)) dto: FeedbackCreateDto) {
    return this.feedback.create(actor.cardId, dto);
  }

  @Get()
  list(@CurrentClient() actor: ClientActor) {
    return this.feedback.listMine(actor.cardId);
  }
}

@Controller('admin/feedback')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.feedback.adminList(status, cursor);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveFeedbackSchema)) dto: ResolveFeedbackDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.feedback.resolve(id, actor.userId, dto.note);
  }
}

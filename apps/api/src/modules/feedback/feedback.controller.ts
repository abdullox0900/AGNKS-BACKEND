import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  feedbackCreateSchema,
  feedbackMessageSchema,
  feedbackTemplateSchema,
  replyFeedbackSchema,
  resolveFeedbackSchema,
  type FeedbackCreateDto,
  type FeedbackMessageDto,
  type FeedbackTemplateDto,
  type ReplyFeedbackDto,
  type ResolveFeedbackDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { AllowBlocked } from '@/common/decorators/allow-blocked.decorator';
import { CurrentClient, CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { ClientActor, StaffActor } from '@/common/types/actor';
import { FeedbackService } from './feedback.service';

/** What the client sees. Open to blocked clients too — that is how they ask to be unblocked. */
@Controller('me/feedback')
@UseGuards(ClientAuthGuard)
@AllowBlocked()
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

  @Get(':id')
  get(@CurrentClient() actor: ClientActor, @Param('id') id: string) {
    return this.feedback.getMine(actor.cardId, id);
  }

  @Post(':id/messages')
  reply(@CurrentClient() actor: ClientActor, @Param('id') id: string, @Body(new ZodValidationPipe(feedbackMessageSchema)) dto: FeedbackMessageDto) {
    return this.feedback.replyMine(actor.cardId, id, dto.message);
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

  /** declared before ':id' so "unread-count" is not taken for an id */
  @Get('unread-count')
  unread() {
    return this.feedback.adminUnreadCount();
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    // root_admin only looks — opening a thread must not clear it for the people who answer
    return this.feedback.adminGet(id, actor.role !== 'root_admin');
  }

  @Post(':id/messages')
  @Roles('branch_manager', 'seo')
  reply(@Param('id') id: string, @Body(new ZodValidationPipe(replyFeedbackSchema)) dto: ReplyFeedbackDto, @CurrentStaff() actor: StaffActor) {
    return this.feedback.adminReply(id, dto.text, actor.userId);
  }

  /** Only the SEO deletes conversations. */
  @Delete(':id')
  @Roles('seo')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.feedback.remove(id, actor.userId);
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

/** Ready-made replies: everyone who answers can use them, only the SEO edits the list. */
@Controller('admin/feedback-templates')
@UseGuards(StaffAuthGuard, RolesGuard)
export class FeedbackTemplatesController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @Roles('branch_manager', 'root_admin', 'seo')
  list() {
    return this.feedback.listTemplates();
  }

  @Post()
  @Roles('seo')
  create(@Body(new ZodValidationPipe(feedbackTemplateSchema)) dto: FeedbackTemplateDto, @CurrentStaff() actor: StaffActor) {
    return this.feedback.createTemplate(dto, actor.userId);
  }

  @Put(':id')
  @Roles('seo')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(feedbackTemplateSchema)) dto: FeedbackTemplateDto, @CurrentStaff() actor: StaffActor) {
    return this.feedback.updateTemplate(id, dto, actor.userId);
  }

  @Delete(':id')
  @Roles('seo')
  remove(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.feedback.removeTemplate(id, actor.userId);
  }
}

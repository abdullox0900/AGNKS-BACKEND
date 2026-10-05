import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { reviewApproveSchema, reviewRejectSchema, type ReviewApproveDto, type ReviewRejectDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationScopeGuard } from '@/common/guards/station-scope.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { ReceiptsService } from './receipts.service';

@Controller('admin/review')
@UseGuards(StaffAuthGuard, RolesGuard, StationScopeGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class AdminReviewController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  async list(@Query('cursor') cursor?: string) {
    const { items, nextCursor } = await this.receipts.listPendingReview(cursor);
    // each item carries the soliq.uz link so the reviewer can open the fiscal receipt straight from the queue
    return { items: items.map((r) => ({ ...r, soliqLink: this.receipts.soliqLink(r) })), nextCursor };
  }

  @Get(':receiptId')
  async detail(@Param('receiptId') receiptId: string) {
    const receipt = await this.receipts.reviewDetail(receiptId);
    return { ...receipt, soliqLink: this.receipts.soliqLink(receipt) };
  }

  @Post(':receiptId/approve')
  approve(
    @Param('receiptId') receiptId: string,
    @Body(new ZodValidationPipe(reviewApproveSchema)) dto: ReviewApproveDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.receipts.approve(receiptId, actor.userId, dto.note, dto.amount);
  }

  @Post(':receiptId/reject')
  reject(
    @Param('receiptId') receiptId: string,
    @Body(new ZodValidationPipe(reviewRejectSchema)) dto: ReviewRejectDto,
    @CurrentStaff() actor: StaffActor,
  ) {
    return this.receipts.reject(receiptId, actor.userId, dto.note);
  }
}

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { parseReceiptSchema, submitReceiptSchema, type ParseReceiptDto, type SubmitReceiptDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { CurrentClient } from '@/common/decorators/current-actor.decorator';
import type { ClientActor } from '@/common/types/actor';
import { ReceiptsService } from './receipts.service';
import { HistoryService, type HistoryType } from './history.service';

@Controller('me')
@UseGuards(ClientAuthGuard)
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly history: HistoryService,
  ) {}

  @Post('receipts/parse')
  parse(@Body(new ZodValidationPipe(parseReceiptSchema)) dto: ParseReceiptDto) {
    return this.receipts.parse(dto.qrText);
  }

  @Post('receipts')
  submit(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(submitReceiptSchema)) dto: SubmitReceiptDto) {
    return this.receipts.submit(actor.cardId, dto);
  }

  @Get('receipts/:id')
  getOne(@CurrentClient() actor: ClientActor, @Param('id') id: string) {
    return this.receipts.getById(actor.cardId, id);
  }

  @Get('history')
  listHistory(
    @CurrentClient() actor: ClientActor,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
    @Query('type') type?: HistoryType,
  ) {
    return this.history.list(actor.cardId, cursor, Math.min(Number(limit) || 20, 50), type);
  }

  @Get('history/:type/:id')
  getHistoryOne(@CurrentClient() actor: ClientActor, @Param('type') type: HistoryType, @Param('id') id: string) {
    return this.history.getOne(actor.cardId, type, id);
  }
}

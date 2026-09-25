import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  spendLookupSchema,
  spendSubmitSchema,
  spendVoidSchema,
  type SpendLookupDto,
  type SpendSubmitDto,
  type SpendVoidDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentClient, CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { ClientActor, StaffActor } from '@/common/types/actor';
import { SpendService } from './spend.service';

@Controller('me/spend-token')
@UseGuards(ClientAuthGuard)
export class ClientSpendTokenController {
  constructor(private readonly spend: SpendService) {}

  @Post()
  issue(@CurrentClient() actor: ClientActor) {
    return this.spend.issueToken(actor.cardId);
  }
}

@Controller('cashier/spend')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('cashier')
export class CashierSpendController {
  constructor(private readonly spend: SpendService) {}

  @Post('lookup')
  lookup(@CurrentStaff() actor: StaffActor, @Body(new ZodValidationPipe(spendLookupSchema)) dto: SpendLookupDto) {
    return this.spend.lookup(actor.userId, dto.code);
  }

  @Post()
  submit(@CurrentStaff() actor: StaffActor, @Body(new ZodValidationPipe(spendSubmitSchema)) dto: SpendSubmitDto) {
    return this.spend.submit(actor.userId, dto.sessionId, dto.amount);
  }

  @Post(':id/void')
  void_(
    @CurrentStaff() actor: StaffActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(spendVoidSchema)) dto: SpendVoidDto,
  ) {
    return this.spend.void(actor.userId, id, dto.reason);
  }

  @Get()
  list(@CurrentStaff() actor: StaffActor, @Query('shiftId') shiftId?: string) {
    return this.spend.listForShift(actor.userId, shiftId);
  }
}

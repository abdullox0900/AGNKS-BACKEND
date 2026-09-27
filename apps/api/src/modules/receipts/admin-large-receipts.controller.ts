import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { ReceiptsService } from './receipts.service';

/** Dashboard alert for unusually large receipts (≥ receipt.large_alert_amount). */
@Controller('admin/receipts')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('root_admin', 'seo')
export class AdminLargeReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('large')
  listLarge() {
    return this.receipts.listLarge();
  }

  @Post(':id/ack-large')
  ackLarge(@Param('id') id: string, @CurrentStaff() actor: StaffActor) {
    return this.receipts.ackLarge(id, actor.userId);
  }
}

import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ReceiptsService } from './receipts.service';

/** One receipt of a client with the full soliq.uz record (dashboard client page). */
@Controller('admin/clients')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('branch_manager', 'seo') // not root_admin: opening a client is closed to the view-only role
export class AdminClientReceiptController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(':id/receipts/:receiptId')
  detail(@Param('id') id: string, @Param('receiptId') receiptId: string) {
    return this.receipts.adminClientReceipt(id, receiptId);
  }
}

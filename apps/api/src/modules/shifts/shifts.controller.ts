import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { StationScopeGuard } from '@/common/guards/station-scope.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { ShiftsService } from './shifts.service';

@Controller('cashier')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('cashier')
export class CashierShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('me')
  me(@CurrentStaff() actor: StaffActor) {
    return this.shifts.me(actor);
  }

  @Get('shifts/current')
  current(@CurrentStaff() actor: StaffActor) {
    return this.shifts.currentShift(actor);
  }

  @Get('shifts')
  listMine(@CurrentStaff() actor: StaffActor, @Query('cursor') cursor?: string) {
    return this.shifts.listMine(actor, cursor);
  }
}

@Controller('admin/shifts')
@UseGuards(StaffAuthGuard, RolesGuard, StationScopeGuard)
@Roles('branch_manager', 'root_admin', 'seo')
export class AdminShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('stationId') stationId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.shifts.adminList({ status, stationId, from, to });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.shifts.adminDetail(id);
  }
}

import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CashierShiftsController, AdminShiftsController } from './shifts.controller';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [NotificationsModule, AuthModule],
  controllers: [CashierShiftsController, AdminShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}

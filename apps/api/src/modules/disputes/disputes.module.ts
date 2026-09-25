import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { ClientDisputesController, AdminDisputesController } from './disputes.controller';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [LedgerModule, NotificationsModule, AuthModule],
  controllers: [ClientDisputesController, AdminDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}

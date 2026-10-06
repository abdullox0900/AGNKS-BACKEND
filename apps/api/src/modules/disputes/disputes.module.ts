import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { ClientDisputesController, AdminDisputesController } from './disputes.controller';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AuditModule } from '@/modules/audit/audit.module';

@Module({
  imports: [LedgerModule, NotificationsModule, AuthModule, AuditModule],
  controllers: [ClientDisputesController, AdminDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}

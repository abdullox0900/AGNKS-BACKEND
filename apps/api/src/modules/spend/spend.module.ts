import { Module } from '@nestjs/common';
import { SpendService } from './spend.service';
import { SpendTokenService } from './spend-token.service';
import { SpendSessionService } from './spend-session.service';
import { ClientSpendTokenController, CashierSpendController } from './spend.controller';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [LedgerModule, RulesModule, NotificationsModule, AuthModule],
  controllers: [ClientSpendTokenController, CashierSpendController],
  providers: [SpendService, SpendTokenService, SpendSessionService],
  exports: [SpendService],
})
export class SpendModule {}

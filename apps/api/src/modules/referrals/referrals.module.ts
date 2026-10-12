import { Module } from '@nestjs/common';
import { AuditModule } from '@/modules/audit/audit.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { AdminReferralsController, ClientReferralController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [AuditModule, RulesModule],
  controllers: [ClientReferralController, AdminReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}

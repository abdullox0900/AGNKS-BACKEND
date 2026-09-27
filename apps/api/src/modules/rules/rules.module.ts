import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { RateResolverService } from './rate-resolver.service';
import { PromotionsService } from './promotions.service';
import { RulesController } from './rules.controller';
import { AuditModule } from '@/modules/audit/audit.module';
import { BroadcastsCoreModule } from '@/modules/broadcasts/broadcasts.module';

@Module({
  imports: [AuditModule, BroadcastsCoreModule],
  controllers: [RulesController],
  providers: [SettingsService, RateResolverService, PromotionsService],
  exports: [SettingsService, RateResolverService, PromotionsService],
})
export class RulesModule {}

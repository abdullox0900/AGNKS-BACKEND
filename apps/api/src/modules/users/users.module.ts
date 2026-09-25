import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { StaffService } from './staff.service';
import { AdminClientsService } from './admin-clients.service';
import { ClientMeController } from './client-me.controller';
import { StaffController } from './staff.controller';
import { AdminClientsController } from './admin-clients.controller';
import { RulesModule } from '@/modules/rules/rules.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';

@Module({
  imports: [RulesModule, AuditModule, AuthModule, LedgerModule],
  controllers: [ClientMeController, StaffController, AdminClientsController],
  providers: [UsersService, StaffService, AdminClientsService],
  exports: [UsersService, StaffService],
})
export class UsersModule {}

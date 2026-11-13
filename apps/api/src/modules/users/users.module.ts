import { ClientPhotoController } from './client-photo.controller';
import { ClientPhotoService } from './client-photo.service';
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
import { NotificationsModule } from '@/modules/notifications/notifications.module';

@Module({
  imports: [RulesModule, AuditModule, AuthModule, LedgerModule, NotificationsModule],
  controllers: [ClientMeController, StaffController, AdminClientsController, ClientPhotoController],
  providers: [UsersService, StaffService, AdminClientsService, ClientPhotoService],
  exports: [UsersService, StaffService],
})
export class UsersModule {}

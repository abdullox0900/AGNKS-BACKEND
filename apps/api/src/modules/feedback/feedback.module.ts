import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { ClientFeedbackController, AdminFeedbackController } from './feedback.controller';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AuditModule } from '@/modules/audit/audit.module';

@Module({
  imports: [NotificationsModule, AuthModule, AuditModule],
  controllers: [ClientFeedbackController, AdminFeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}

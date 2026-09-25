import { Module } from '@nestjs/common';
import { ClientBotService } from './client-bot.service';
import { StaffBotService } from './staff-bot.service';
import { BotController } from './bot.controller';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [BotController],
  providers: [ClientBotService, StaffBotService],
})
export class BotModule {}

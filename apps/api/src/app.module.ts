import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { validateEnv } from '@/config/env.validation';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { TimeoutInterceptor } from '@/common/interceptors/timeout.interceptor';
import { IdempotencyInterceptor } from '@/common/interceptors/idempotency.interceptor';

import { PrismaModule } from '@/infra/prisma/prisma.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { TelegramModule } from '@/infra/telegram/telegram.module';
import { StorageModule } from '@/infra/storage/storage.module';
import { QueueModule } from '@/infra/queue/queue.module';

import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { StationsModule } from '@/modules/stations/stations.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { ReceiptsModule } from '@/modules/receipts/receipts.module';
import { SpendModule } from '@/modules/spend/spend.module';
import { ShiftsModule } from '@/modules/shifts/shifts.module';
import { DisputesModule } from '@/modules/disputes/disputes.module';
import { FeedbackModule } from '@/modules/feedback/feedback.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { BotModule } from '@/modules/bot/bot.module';
import { HealthController } from '@/modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // global 100/daq per IP (TZ-4 §11)

    PrismaModule,
    RedisModule,
    TelegramModule,
    StorageModule,
    QueueModule,

    AuthModule,
    UsersModule,
    StationsModule,
    RulesModule,
    LedgerModule,
    ReceiptsModule,
    SpendModule,
    ShiftsModule,
    DisputesModule,
    FeedbackModule,
    NotificationsModule,
    AnalyticsModule,
    AuditModule,
    BotModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}

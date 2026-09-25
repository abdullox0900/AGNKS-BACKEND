import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CashierAuthController } from './cashier-auth.controller';
import { DashboardAuthController } from './dashboard-auth.controller';
import { PinAuthService } from './pin-auth.service';
import { DashboardAuthService } from './dashboard-auth.service';
import { TokenService } from './token.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [CashierAuthController, DashboardAuthController],
  providers: [
    PinAuthService,
    DashboardAuthService,
    TokenService,
    CryptoService,
    ClientAuthGuard,
    StaffAuthGuard,
  ],
  exports: [PinAuthService, DashboardAuthService, TokenService, ClientAuthGuard, StaffAuthGuard],
})
export class AuthModule {}

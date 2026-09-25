import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { pinLoginSchema, type PinLoginDto } from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { PinAuthService } from './pin-auth.service';
import { TokenService } from './token.service';

const refreshSchema = z.object({ refreshToken: z.string() });

@Controller('cashier/auth')
export class CashierAuthController {
  constructor(
    private readonly pinAuth: PinAuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(pinLoginSchema)) dto: PinLoginDto) {
    return this.pinAuth.login(dto.phone, dto.pin);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: { refreshToken: string }) {
    const payload = this.tokens.verifyRefresh(dto.refreshToken);
    const base = { sub: payload.sub, role: payload.role, stationId: payload.stationId, terminalIds: payload.terminalIds };
    return {
      accessToken: this.tokens.signAccess(base, '15m'),
      refreshToken: this.tokens.signRefresh(base, '12h'),
    };
  }
}

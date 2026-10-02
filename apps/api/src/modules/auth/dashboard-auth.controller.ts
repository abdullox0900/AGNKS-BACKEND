import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@agnks/types';
import {
  dashboardLoginSchema,
  changePasswordSchema,
  type DashboardLoginDto,
  type ChangePasswordDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StaffAuthGuard } from '@/common/guards/staff-auth.guard';
import { CurrentStaff } from '@/common/decorators/current-actor.decorator';
import type { StaffActor } from '@/common/types/actor';
import { DashboardAuthService } from './dashboard-auth.service';
import { TokenService } from './token.service';

const REFRESH_COOKIE = 'admin_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('admin/auth')
export class DashboardAuthController {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(dashboardLoginSchema)) dto: DashboardLoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.auth.login(dto.phone, dto.password);
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Get('me')
  @UseGuards(StaffAuthGuard)
  me(@CurrentStaff() actor: StaffActor) {
    return this.auth.me(actor.userId);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(StaffAuthGuard)
  async changePassword(
    @CurrentStaff() actor: StaffActor,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(actor.userId, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError('AUTH_FORBIDDEN', { reason: 'missing_refresh_cookie' });

    const payload = this.tokens.verifyRefresh(token);
    const base = { sub: payload.sub, role: payload.role, stationId: payload.stationId, terminalIds: payload.terminalIds };
    const accessToken = this.tokens.signAccess(base, '15m');
    const refreshToken = this.tokens.signRefresh(base, '7d');
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE);
    return { success: true };
  }
}

function setRefreshCookie(res: Response, token: string): void {
  // The dashboard webapp runs on its own origin (different port from the API), so this
  // cookie is cross-site from the browser's point of view — SameSite=Strict/Lax would
  // never be sent on that XHR at all. Cross-site cookies require SameSite=None + Secure,
  // which needs HTTPS (see DEV_HTTPS in main.ts for local dev).
  const secure = process.env.NODE_ENV === 'production' || process.env.DEV_HTTPS === 'true';
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/api/v1/admin/auth',
  });
}

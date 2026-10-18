import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  registerSchema,
  updateMeSchema,
  marketingConsentSchema,
  type RegisterDto,
  type UpdateMeDto,
  type MarketingConsentDto,
} from '@agnks/types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CurrentClient } from '@/common/decorators/current-actor.decorator';
import { ClientAuthGuard } from '@/common/guards/client-auth.guard';
import { AllowBlocked } from '@/common/decorators/allow-blocked.decorator';
import type { ClientActor } from '@/common/types/actor';
import { UsersService } from './users.service';

@Controller('me')
@UseGuards(ClientAuthGuard)
export class ClientMeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @AllowBlocked()
  getMe(@CurrentClient() actor: ClientActor) {
    return this.users.getMe(actor.userId);
  }

  @Patch()
  updateMe(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(updateMeSchema)) dto: UpdateMeDto) {
    return this.users.updateMe(actor.userId, dto);
  }

  @Post('register')
  register(@CurrentClient() actor: ClientActor, @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.users.register(actor.userId, dto);
  }

  @Get('rate')
  rate(@Query('stationId') stationId?: string) {
    return this.users.rate(stationId);
  }

  @Post('logout')
  logout(@CurrentClient() actor: ClientActor) {
    return this.users.logout(actor.userId);
  }

  @Get('promotions')
  promotions(@CurrentClient() actor: ClientActor) {
    return this.users.promotions(actor.cardId);
  }

  @Patch('marketing')
  async setMarketing(
    @CurrentClient() actor: ClientActor,
    @Body(new ZodValidationPipe(marketingConsentSchema)) dto: MarketingConsentDto,
  ) {
    await this.users.setMarketingConsent(actor.userId, dto.accepted, dto.version);
    return { accepted: dto.accepted };
  }
}

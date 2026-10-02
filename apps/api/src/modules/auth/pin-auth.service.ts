import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import { TokenService } from './token.service';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class PinAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
  ) {}

  async login(phone: string, pin: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: { where: { role: 'cashier' } }, credentials: true },
    });

    const role = user?.roles[0];
    if (!user || !role || !user.credentials?.pinHash) {
      throw new AppError('AUTH_STAFF_NOT_FOUND');
    }

    const creds = user.credentials;
    if (creds.lockedUntil && creds.lockedUntil > new Date()) {
      throw new AppError('AUTH_LOCKED', { until: creds.lockedUntil.toISOString() });
    }

    const valid = await argon2.verify(creds.pinHash!, pin);
    if (!valid) {
      await this.registerFailure(user.id, creds.failedAttempts);
      throw new AppError('AUTH_FORBIDDEN', { reason: 'invalid_pin' });
    }

    await this.prisma.staffCredentials.update({
      where: { userId: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    const base = { sub: user.id, role: role.role, stationId: role.stationId, terminalIds: role.terminalIds };
    return {
      accessToken: this.tokens.signAccess(base, '15m'),
      refreshToken: this.tokens.signRefresh(base, '12h'),
    };
  }

  private async registerFailure(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await this.prisma.staffCredentials.update({
      where: { userId },
      data: { failedAttempts: lockedUntil ? 0 : attempts, lockedUntil },
    });
  }

  async setPin(userId: string, pin: string): Promise<void> {
    const pinHash = await argon2.hash(pin);
    // reversible copy so managers can look the cashier's password up again (see StaffService.list)
    const passwordEnc = this.crypto.encrypt(pin);
    await this.prisma.staffCredentials.upsert({
      where: { userId },
      create: { userId, pinHash, passwordEnc },
      update: { pinHash, passwordEnc, failedAttempts: 0, lockedUntil: null },
    });
  }
}

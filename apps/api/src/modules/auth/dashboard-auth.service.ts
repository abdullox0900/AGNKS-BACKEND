import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppError, isNetworkWideRole, type StaffRole } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import { TokenService } from './token.service';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DASHBOARD_ROLES: StaffRole[] = ['branch_manager', 'root_admin', 'seo'];

@Injectable()
export class DashboardAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
  ) {}

  async login(phone: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: true, credentials: true },
    });

    const role = user?.roles.find((r) => DASHBOARD_ROLES.includes(r.role));
    if (!user || !role || !user.credentials?.passwordHash) {
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    const creds = user.credentials;
    if (creds.lockedUntil && creds.lockedUntil > new Date()) {
      throw new AppError('AUTH_LOCKED', { until: creds.lockedUntil.toISOString() });
    }

    const valid = await argon2.verify(creds.passwordHash!, password);
    if (!valid) {
      await this.registerFailure(user.id, creds.failedAttempts);
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    await this.prisma.staffCredentials.update({
      where: { userId: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    return this.issueTokens(user.id, role.role, role.stationId);
  }

  /** Step-up confirmation for destructive actions (e.g. deleting another admin account) —
   * checks the ACTING user's own password, independent of login rate-limiting/lockout. */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const creds = await this.prisma.staffCredentials.findUnique({ where: { userId } });
    if (!creds?.passwordHash) return false;
    return argon2.verify(creds.passwordHash, password);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { station: true } } },
    });
    const role = user?.roles.find((r) => DASHBOARD_ROLES.includes(r.role));
    if (!user || !role) throw new AppError('NOT_FOUND');
    return {
      id: user.id,
      firstName: user.firstName,
      phone: user.phone,
      role: role.role,
      stationId: role.stationId,
      stationName: role.station?.name ?? null,
    };
  }

  /** Self-service password change — requires the current password. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const creds = await this.prisma.staffCredentials.findUnique({ where: { userId } });
    if (!creds?.passwordHash) throw new AppError('AUTH_INVALID_CREDENTIALS');

    const valid = await argon2.verify(creds.passwordHash, currentPassword);
    if (!valid) throw new AppError('AUTH_INVALID_CREDENTIALS');

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.staffCredentials.update({ where: { userId }, data: { passwordHash, passwordEnc: this.crypto.encrypt(newPassword) } });
  }

  /** Sets (or replaces) a dashboard account's password. Keeps a reversible copy for SEO and lifts any lockout. */
  async setPassword(userId: string, password: string): Promise<void> {
    const passwordHash = await argon2.hash(password);
    const passwordEnc = this.crypto.encrypt(password);
    await this.prisma.staffCredentials.upsert({
      where: { userId },
      create: { userId, passwordHash, passwordEnc },
      update: { passwordHash, passwordEnc, failedAttempts: 0, lockedUntil: null },
    });
  }

  /** userId → current password, for the accounts that have a stored copy (older accounts don't until reset). */
  async readPasswords(userIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.staffCredentials.findMany({
      where: { userId: { in: userIds }, passwordEnc: { not: null } },
      select: { userId: true, passwordEnc: true },
    });
    const out = new Map<string, string>();
    for (const r of rows) {
      try {
        out.set(r.userId, this.crypto.decrypt(r.passwordEnc!));
      } catch {
        // encryption key changed since it was stored — treat as "not available"
      }
    }
    return out;
  }

  private issueTokens(userId: string, role: StaffRole, stationId: string | null) {
    const base = { sub: userId, role, stationId: isNetworkWideRole(role) ? null : stationId, terminalIds: [] };
    return {
      accessToken: this.tokens.signAccess(base, '15m'),
      refreshToken: this.tokens.signRefresh(base, '7d'),
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
}

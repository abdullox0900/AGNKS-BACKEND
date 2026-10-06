import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { DashboardAuthService } from '@/modules/auth/dashboard-auth.service';
import { AuditService } from '@/modules/audit/audit.service';

const KEY = 'datafix.gate';
const TTL_MS = 15 * 60_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

/**
 * A second lock in front of the data-correction page: its own password (not anyone's login password), set once
 * by a SEO and asked every time the page is opened. A correct password gives a signed token valid for 15
 * minutes. The hash lives in the `settings` table under a key that is not part of the typed settings, so the
 * settings API never returns it.
 */
@Injectable()
export class DataFixGateService {
  private readonly fails = new Map<string, { n: number; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: DashboardAuthService,
    private readonly audit: AuditService,
  ) {}

  private async hash(): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return (row?.value as { hash?: string } | null)?.hash ?? null;
  }

  async status() {
    return { configured: !!(await this.hash()) };
  }

  async setup(userId: string, password: string, loginPassword: string) {
    if (await this.hash()) throw new AppError('VALIDATION_ERROR', { message: 'gate_already_set' });
    // creating the lock needs the SEO's own login password once
    if (!(await this.auth.verifyPassword(userId, loginPassword))) throw new AppError('AUTH_INVALID_CREDENTIALS', { reason: 'login_password' });
    await this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { hash: await argon2.hash(password) }, updatedBy: userId },
      update: { value: { hash: await argon2.hash(password) }, updatedBy: userId },
    });
    await this.audit.record({ actorId: userId, action: 'datafix.gate_set', entityType: 'setting', entityId: KEY });
    return this.issue(userId);
  }

  async unlock(userId: string, password: string) {
    this.assertNotLocked(userId);
    const hash = await this.hash();
    if (!hash) throw new AppError('VALIDATION_ERROR', { message: 'gate_not_set' });
    if (!(await argon2.verify(hash, password))) {
      this.fail(userId);
      await this.audit.record({ actorId: userId, action: 'datafix.unlock_failed', entityType: 'setting', entityId: KEY });
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }
    this.fails.delete(userId);
    await this.audit.record({ actorId: userId, action: 'datafix.unlock', entityType: 'setting', entityId: KEY });
    return this.issue(userId);
  }

  async change(userId: string, current: string, next: string) {
    this.assertNotLocked(userId);
    const hash = await this.hash();
    if (!hash || !(await argon2.verify(hash, current))) {
      this.fail(userId);
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }
    await this.prisma.setting.update({ where: { key: KEY }, data: { value: { hash: await argon2.hash(next) }, updatedBy: userId } });
    await this.audit.record({ actorId: userId, action: 'datafix.gate_changed', entityType: 'setting', entityId: KEY });
    return this.issue(userId);
  }

  // ---- token ----

  private sign(payload: string): string {
    return createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET', 'dev-secret')).update(`datafix:${payload}`).digest('base64url');
  }

  issue(userId: string) {
    const exp = Date.now() + TTL_MS;
    const payload = `${userId}.${exp}`;
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  verify(token: string | undefined, userId: string): boolean {
    if (!token) return false;
    const [uid, exp, sig] = token.split('.');
    if (!uid || !exp || !sig || uid !== userId || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(this.sign(`${uid}.${exp}`));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  // ---- brute-force limit: 5 wrong passwords lock the user out for 15 minutes ----

  private assertNotLocked(userId: string) {
    const f = this.fails.get(userId);
    if (f && f.n >= MAX_FAILS && f.until > Date.now()) throw new AppError('RATE_LIMITED');
  }

  private fail(userId: string) {
    const now = Date.now();
    const f = this.fails.get(userId);
    const n = f && f.until > now ? f.n + 1 : 1;
    this.fails.set(userId, { n, until: now + LOCK_MS });
  }
}

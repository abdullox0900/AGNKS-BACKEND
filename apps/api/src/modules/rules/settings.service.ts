import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SETTINGS_DEFAULTS, SETTING_KEYS, settingsSchemas, type SettingKey, type SettingsMap } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';

/**
 * Every tunable in the system lives in one `settings` table (TZ-4 §13) so it
 * can change from the dashboard without a deploy. A small in-process cache
 * keeps hot paths (rate lookup on every receipt) off the database; it's
 * refreshed on write and re-read lazily on TTL expiry, so a stale replica
 * self-heals within seconds rather than needing invalidation plumbing.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly cacheTtlMs = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as SettingsMap[K];
    }

    const row = await this.prisma.setting.findUnique({ where: { key } }).catch(() => null);
    const value = (row ? row.value : SETTINGS_DEFAULTS[key]) as SettingsMap[K];
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  async getAll(): Promise<SettingsMap> {
    const entries = await Promise.all(SETTING_KEYS.map(async (key) => [key, await this.get(key)] as const));
    return Object.fromEntries(entries) as SettingsMap;
  }

  async set<K extends SettingKey>(key: K, value: unknown, actorId: string): Promise<void> {
    const parsed = settingsSchemas[key].parse(value);

    const before = await this.get(key);
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: parsed as Prisma.InputJsonValue, updatedBy: actorId },
      update: { value: parsed as Prisma.InputJsonValue, updatedBy: actorId },
    });
    this.cache.delete(key);

    await this.audit.record({
      actorId,
      action: 'settings.update',
      entityType: 'setting',
      entityId: key,
      before,
      after: parsed,
    });
    this.logger.log(`Setting ${key} updated by ${actorId}`);
  }
}

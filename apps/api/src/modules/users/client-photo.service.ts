import { createHmac, timingSafeEqual } from 'crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { CLIENT_BOTS } from '@/infra/telegram/telegram.constants';
import type { ClientBotEntry, ClientBotRegistry } from '@/infra/telegram/client-bots';

const DAY_MS = 86_400_000;
const HIT_TTL = 12 * 3_600_000;
const MISS_TTL = 6 * 3_600_000;
const MAX_ENTRIES = 3000;

/**
 * A client's Telegram profile picture for the dashboard. Telegram serves the file only via a URL that contains the
 * bot token, so the browser never gets that URL: it gets `/api/v1/client-photo/<userId>?e&s` (signed, valid for a
 * day — the same URL all day, so the browser caches it), and this service fetches the smallest size (160 px, a few
 * KB) once and keeps it in memory. No photo / privacy settings / Telegram down → 404 and the UI shows initials.
 */
@Injectable()
export class ClientPhotoService {
  private readonly logger = new Logger(ClientPhotoService.name);
  private readonly cache = new Map<string, { at: number; buf: Buffer | null }>();
  private readonly inflight = new Map<string, Promise<Buffer | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @Inject(CLIENT_BOTS) private readonly bots?: ClientBotRegistry,
  ) {}

  private sign(userId: string, exp: number): string {
    return createHmac('sha256', `${this.config.get<string>('JWT_ACCESS_SECRET')}:client-photo`).update(`${userId}.${exp}`).digest('base64url').slice(0, 32);
  }

  /** Signed path for a client who has Telegram linked; `null` otherwise. */
  urlFor(userId: string, hasTelegram: boolean, now = Date.now()): string | null {
    if (!hasTelegram || !this.bots) return null;
    const exp = Math.floor(now / DAY_MS) * DAY_MS + 2 * DAY_MS; // same value for the whole day
    return `/api/v1/client-photo/${userId}?e=${exp}&s=${this.sign(userId, exp)}`;
  }

  verify(userId: string, e: string | undefined, s: string | undefined, now = Date.now()): boolean {
    const exp = Number(e);
    if (!s || !Number.isFinite(exp) || exp < now) return false;
    const want = Buffer.from(this.sign(userId, exp));
    const got = Buffer.from(s);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async photo(userId: string): Promise<Buffer | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < (hit.buf ? HIT_TTL : MISS_TTL)) return hit.buf;
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const run = this.load(userId)
      .catch((err) => {
        this.logger.warn(`client photo ${userId}: ${(err as Error).message}`);
        return null;
      })
      .then((buf) => {
        this.cache.set(userId, { at: Date.now(), buf });
        if (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
        return buf;
      })
      .finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, run);
    return run;
  }

  private async load(userId: string): Promise<Buffer | null> {
    if (!this.bots) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { tgUserId: true, botKey: true } });
    if (!user?.tgUserId) return null;
    // the client's own bot first (it is the one they talked to), then the main one
    const tries = [this.bots.get(user.botKey), this.bots.fallback()].filter((b, i, a): b is ClientBotEntry => !!b && a.indexOf(b) === i);
    for (const entry of tries) {
      try {
        const res = await entry.bot.api.getUserProfilePhotos(Number(user.tgUserId), { limit: 1 });
        const sizes = res.photos[0];
        if (!sizes?.length) return null;
        const small = sizes[0];
        const file = await entry.bot.api.getFile(small.file_id);
        if (!file.file_path) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8_000);
        try {
          const r = await fetch(`https://api.telegram.org/file/bot${entry.token}/${file.file_path}`, { signal: ctrl.signal });
          if (!r.ok) return null;
          return Buffer.from(await r.arrayBuffer());
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // try the next bot
      }
    }
    return null;
  }
}

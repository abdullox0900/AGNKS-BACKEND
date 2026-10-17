import type { PrismaService } from '@/infra/prisma/prisma.service';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
/** `lastSeenAt` is refreshed at most this often per person — the app polls /me every ~90 s, the table must not. */
const SEEN_EVERY_MS = 5 * 60 * 1000;

const seen = new Map<string, { at: number; day: string }>();

/** "2026-10-17" in Tashkent time. */
export const tashkentDay = (ms = Date.now()) => new Date(ms + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Remembers that a client just opened the app: `users.last_seen_at` (at most every 5 min) and one
 * `client_activity_days` row per Tashkent day. Best effort and never awaited by the caller — a failure here
 * must not break the request. The in-process map keeps almost every call off the database.
 */
export async function touchClientActivity(prisma: PrismaService, userId: string, now = Date.now()): Promise<void> {
  const day = tashkentDay(now);
  const last = seen.get(userId);
  if (last && last.day === day && now - last.at < SEEN_EVERY_MS) return;
  seen.set(userId, { at: now, day });
  if (seen.size > 50_000) seen.clear();
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } });
    if (!last || last.day !== day) {
      await prisma.clientActivityDay.createMany({ data: [{ userId, day: new Date(`${day}T00:00:00.000Z`) }], skipDuplicates: true });
    }
  } catch {
    seen.delete(userId); // try again on the next request
  }
}

/** test helper */
export const resetClientActivityCache = () => seen.clear();

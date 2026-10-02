import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '@agnks/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';

const OUTBOX_KIND = 'client.broadcast';
const OUTBOX_CHUNK = 1000;

type BroadcastRow = Prisma.BroadcastGetPayload<object>;

/**
 * Dashboard → client announcements. Creation only stores the row; the worker's
 * `dispatchDue()` (every 30s) fans a due broadcast out into one outbox row per
 * recipient, and the existing OutboxProcessor delivers those through the client
 * bot at its own pace (retries, backoff, no Telegram flood).
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- dashboard ----------

  async list() {
    const rows = await this.prisma.broadcast.findMany({ orderBy: { sendAt: 'desc' }, take: 100 });
    const stats = await this.deliveryStats(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toDto(r), delivered: stats.get(r.id)?.sent ?? 0, failed: stats.get(r.id)?.failed ?? 0 }));
  }

  async create(input: { textUz: string; textRu?: string | null; sendAt?: Date | null; promotionId?: string | null; createdBy: string }) {
    const now = new Date();
    const sendAt = input.sendAt && input.sendAt > now ? input.sendAt : now;
    const row = await this.prisma.broadcast.create({
      data: {
        textUz: input.textUz,
        textRu: input.textRu || null,
        sendAt,
        promotionId: input.promotionId ?? null,
        createdBy: input.createdBy,
      },
    });
    await this.audit.record({
      actorId: input.createdBy,
      action: 'broadcast.create',
      entityType: 'broadcast',
      entityId: row.id,
      after: row,
    });
    return toDto(row);
  }

  async cancel(id: string, actorId: string) {
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) throw new AppError('NOT_FOUND');
    if (existing.status !== 'scheduled') {
      throw new AppError('VALIDATION_ERROR', { message: 'Only a scheduled broadcast can be cancelled' });
    }
    const updated = await this.prisma.broadcast.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'broadcast.cancel',
      entityType: 'broadcast',
      entityId: id,
      before: existing,
      after: updated,
    });
    return toDto(updated);
  }

  /**
   * Hard delete. Also drops the Telegram messages that haven't gone out yet (pending/failed outbox rows),
   * so a deleted broadcast stops reaching people; messages already delivered can't be recalled.
   * The webapp "Xabarlar" feed reads this table, so it disappears there too.
   */
  async remove(id: string, actorId: string) {
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) throw new AppError('NOT_FOUND');
    if (existing.status === 'sending') {
      throw new AppError('VALIDATION_ERROR', { message: 'Broadcast is being sent right now — try again in a minute' });
    }
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM outbox
        WHERE kind = ${OUTBOX_KIND} AND payload->>'broadcastId' = ${id} AND status IN ('pending', 'failed')`,
      this.prisma.broadcast.delete({ where: { id } }),
    ]);
    await this.audit.record({
      actorId,
      action: 'broadcast.delete',
      entityType: 'broadcast',
      entityId: id,
      before: existing,
    });
    return { id };
  }

  /** Announcement for a new promotion, in both languages, generated from its data. */
  async createForPromotion(
    promo: { id: string; name: string; rateBps: number; stationIds: string[]; startsAt: Date; endsAt: Date },
    notifyAt: Date,
    createdBy: string,
  ) {
    const stations = promo.stationIds.length
      ? await this.prisma.station.findMany({ where: { id: { in: promo.stationIds } }, select: { name: true } })
      : [];
    const names = stations.map((s) => s.name).join(', ');
    const percent = promo.rateBps / 100;
    const period = `${formatTashkent(promo.startsAt)} — ${formatTashkent(promo.endsAt)}`;

    return this.create({
      textUz: `🔥 Yangi aksiya: ${promo.name}\n\nHar bir chekdan ${percent}% bonus\n📅 ${period}\n📍 ${names || 'Barcha shoxobchalarda'}`,
      textRu: `🔥 Новая акция: ${promo.name}\n\n${percent}% бонусов с каждого чека\n📅 ${period}\n📍 ${names || 'На всех АЗС'}`,
      sendAt: notifyAt,
      promotionId: promo.id,
      createdBy,
    });
  }

  /** A cancelled promotion must never be announced afterwards. */
  async cancelForPromotion(promotionId: string): Promise<void> {
    await this.prisma.broadcast.updateMany({
      where: { promotionId, status: 'scheduled' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  // ---------- webapp feed ----------

  async news(limit = 50) {
    const rows = await this.prisma.broadcast.findMany({
      where: { status: 'sent' },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      textUz: r.textUz,
      textRu: r.textRu,
      sentAt: (r.sentAt ?? r.sendAt).toISOString(),
    }));
  }

  // ---------- worker ----------

  async dispatchDue(): Promise<void> {
    const due = await this.prisma.broadcast.findMany({
      where: { status: 'scheduled', sendAt: { lte: new Date() } },
      orderBy: { sendAt: 'asc' },
      take: 10,
    });
    for (const b of due) {
      // Claim it first so two worker ticks can never fan out the same broadcast twice.
      const claimed = await this.prisma.broadcast.updateMany({
        where: { id: b.id, status: 'scheduled' },
        data: { status: 'sending' },
      });
      if (claimed.count !== 1) continue;

      try {
        await this.fanOut(b);
      } catch (err) {
        this.logger.error(`broadcast ${b.id} fan-out failed: ${(err as Error).message}`);
        await this.prisma.broadcast.update({ where: { id: b.id }, data: { status: 'scheduled' } });
      }
    }
  }

  private async fanOut(b: BroadcastRow): Promise<void> {
    if (b.promotionId) {
      const promo = await this.prisma.promotion.findUnique({ where: { id: b.promotionId } });
      if (!promo || promo.cancelledAt) {
        await this.prisma.broadcast.update({ where: { id: b.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
        return;
      }
    }

    // Telegram push only to clients who switched promo messages on; the webapp
    // feed (news) shows the broadcast to everyone.
    const recipients = await this.prisma.user.findMany({
      where: {
        tgUserId: { not: null },
        status: 'active',
        registeredAt: { not: null },
        consents: { some: { type: 'marketing', revokedAt: null } },
      },
      select: { tgUserId: true, lang: true },
    });

    const rows = recipients.map((u) => ({
      kind: OUTBOX_KIND,
      payload: {
        broadcastId: b.id,
        tgUserId: Number(u.tgUserId),
        text: u.lang === 'ru' && b.textRu ? b.textRu : b.textUz,
      },
    }));

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += OUTBOX_CHUNK) {
        await tx.outbox.createMany({ data: rows.slice(i, i + OUTBOX_CHUNK) });
      }
      await tx.broadcast.update({
        where: { id: b.id },
        data: { status: 'sent', sentAt: new Date(), recipientCount: rows.length },
      });
    });
    this.logger.log(`broadcast ${b.id} queued for ${rows.length} recipients`);
  }

  private async deliveryStats(ids: string[]): Promise<Map<string, { sent: number; failed: number }>> {
    const map = new Map<string, { sent: number; failed: number }>();
    if (ids.length === 0) return map;
    const rows = await this.prisma.$queryRaw<{ id: string; status: string; n: bigint }[]>`
      SELECT payload->>'broadcastId' AS id, status::text AS status, COUNT(*) AS n
      FROM outbox
      WHERE kind = ${OUTBOX_KIND} AND payload->>'broadcastId' IN (${Prisma.join(ids)})
      GROUP BY 1, 2`;
    for (const r of rows) {
      const entry = map.get(r.id) ?? { sent: 0, failed: 0 };
      if (r.status === 'sent') entry.sent += Number(r.n);
      if (r.status === 'dead') entry.failed += Number(r.n);
      map.set(r.id, entry);
    }
    return map;
  }
}

function toDto(r: BroadcastRow) {
  return {
    id: r.id,
    textUz: r.textUz,
    textRu: r.textRu,
    sendAt: r.sendAt.toISOString(),
    status: r.status,
    promotionId: r.promotionId,
    recipientCount: r.recipientCount,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}

function formatTashkent(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

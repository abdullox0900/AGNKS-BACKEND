import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GrammyError, type Bot } from 'grammy';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { CLIENT_BOT, CLIENT_BOTS, STAFF_BOT } from '@/infra/telegram/telegram.constants';
import type { ClientBotRegistry } from '@/infra/telegram/client-bots';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { isHtmlMessage, renderMessage } from '@/modules/notifications/message-renderer';
import { STAFF_KIND_ALLOWED, type OutboxKind } from '@/modules/notifications/notifications.service';

const BATCH_SIZE = 50;

/**
 * Runs on a 1s repeatable schedule (see JobsSchedulerService). Polling the
 * table — rather than enqueueing a BullMQ job per outbox row at write time —
 * means a message written just before a Redis outage is still picked up the
 * moment Redis (and this worker) come back, with no code path that can drop it.
 */
@Processor(QUEUE_NAMES.outbox, { concurrency: 1 })
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLIENT_BOT) private readonly clientBot: Bot | null,
    @Inject(STAFF_BOT) private readonly staffBot: Bot | null,
    @Optional() @Inject(CLIENT_BOTS) private readonly registry?: ClientBotRegistry,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const rows = await this.prisma.outbox.findMany({
      where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of rows) {
      await this.dispatchOne(row);
    }
  }

  private async dispatchOne(row: {
    id: string;
    kind: string;
    payload: unknown;
    attempts: number;
  }): Promise<void> {
    try {
      const payload = row.payload as Record<string, unknown>;
      const kind = row.kind as OutboxKind;
      if (kind.startsWith('staff.') && kind !== STAFF_KIND_ALLOWED) {
        // queued before the staff bot went silent — discard instead of sending
        await this.prisma.outbox.update({ where: { id: row.id }, data: { status: 'sent' } });
        return;
      }
      const recipients = await this.resolveRecipients(kind, payload);

      const isStaff = kind.startsWith('staff.');
      if (isStaff ? !this.staffBot : !this.clientBot && !this.registry?.fallback()) throw new Error('bot_unavailable');

      if (recipients.length === 0) {
        // No one to notify (e.g. client has no linked Telegram account yet) —
        // that's not a delivery failure, so don't retry it forever.
        await this.prisma.outbox.update({ where: { id: row.id }, data: { status: 'sent' } });
        return;
      }

      // each recipient gets the text in their own language (the one chosen in the webapp)
      const people = await this.peopleOf(recipients);
      const options = isHtmlMessage(kind) ? { parse_mode: 'HTML' as const } : undefined;
      const results = await Promise.allSettled(
        recipients.map((tgUserId) => {
          const person = people.get(tgUserId);
          // clients are written to by the bot they opened the app from; everyone else (and unknown) by the main one
          const bot = isStaff ? this.staffBot! : (this.registry?.get(person?.botKey) ?? this.registry?.fallback())?.bot ?? this.clientBot!;
          return bot.api.sendMessage(tgUserId, renderMessage(kind, payload, person?.lang ?? 'uz'), options);
        }),
      );
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      for (const failure of failures) {
        this.logger.warn(`sendMessage failed: ${(failure.reason as Error)?.message ?? failure.reason}`);
      }

      if (failures.length === results.length && failures.every((f) => isBlocked(f.reason))) {
        // 403: the user blocked the bot / deleted the chat — retrying can't help.
        await this.prisma.outbox.update({ where: { id: row.id }, data: { status: 'dead', lastError: 'blocked_by_user' } });
        return;
      }

      if (failures.length === results.length) {
        // Every recipient failed — treat as a full delivery failure so it retries.
        throw new Error(`all_recipients_failed: ${failures[0]?.reason?.message ?? 'unknown'}`);
      }

      await this.prisma.outbox.update({ where: { id: row.id }, data: { status: 'sent' } });
    } catch (err) {
      const attempts = row.attempts + 1;
      const dead = attempts >= 6;
      await this.prisma.outbox.update({
        where: { id: row.id },
        data: {
          attempts,
          status: dead ? 'dead' : 'failed',
          lastError: (err as Error).message,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
    }
  }

  private async peopleOf(tgIds: number[]): Promise<Map<number, { lang: 'uz' | 'ru'; botKey: string | null }>> {
    const users = await this.prisma.user.findMany({ where: { tgUserId: { in: tgIds.map((n) => BigInt(n)) } }, select: { tgUserId: true, lang: true, botKey: true } });
    return new Map(users.map((u) => [Number(u.tgUserId), { lang: u.lang as 'uz' | 'ru', botKey: u.botKey }]));
  }

  private async resolveRecipients(kind: OutboxKind, payload: Record<string, unknown>): Promise<number[]> {
    if (typeof payload.tgUserId === 'number') return [payload.tgUserId];
    if (kind.startsWith('client.')) {
      const cardId = payload.cardId as string | undefined;
      if (!cardId) return [];
      const card = await this.prisma.card.findUnique({ where: { id: cardId }, include: { user: true } });
      return card?.user.tgUserId ? [Number(card.user.tgUserId)] : [];
    }

    const stationId = payload.stationId as string | undefined;
    const roles = await this.prisma.userRole.findMany({
      where: {
        OR: [
          { role: { in: ['root_admin', 'seo'] } },
          ...(stationId ? [{ role: 'branch_manager' as const, stationId }] : []),
        ],
      },
      include: { user: true },
    });
    return roles.map((r) => r.user.tgUserId).filter((id): id is bigint => id !== null).map(Number);
  }
}

function isBlocked(reason: unknown): boolean {
  return reason instanceof GrammyError && reason.error_code === 403;
}

function backoffMs(attempt: number): number {
  const steps = [1000, 5000, 25000, 120_000, 600_000];
  return steps[Math.min(attempt - 1, steps.length - 1)];
}

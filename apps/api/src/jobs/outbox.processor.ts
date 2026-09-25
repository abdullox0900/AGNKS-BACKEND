import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Bot } from 'grammy';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { CLIENT_BOT, STAFF_BOT } from '@/infra/telegram/telegram.constants';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { renderMessage } from '@/modules/notifications/message-renderer';
import type { OutboxKind } from '@/modules/notifications/notifications.service';

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
      const recipients = await this.resolveRecipients(kind, payload);
      const text = renderMessage(kind, payload);

      const bot = kind.startsWith('staff.') ? this.staffBot : this.clientBot;
      if (!bot) throw new Error('bot_unavailable');

      if (recipients.length === 0) {
        // No one to notify (e.g. client has no linked Telegram account yet) —
        // that's not a delivery failure, so don't retry it forever.
        await this.prisma.outbox.update({ where: { id: row.id }, data: { status: 'sent' } });
        return;
      }

      const results = await Promise.allSettled(recipients.map((tgUserId) => bot.api.sendMessage(tgUserId, text)));
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      for (const failure of failures) {
        this.logger.warn(`sendMessage failed: ${(failure.reason as Error)?.message ?? failure.reason}`);
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

  private async resolveRecipients(kind: OutboxKind, payload: Record<string, unknown>): Promise<number[]> {
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

function backoffMs(attempt: number): number {
  const steps = [1000, 5000, 25000, 120_000, 600_000];
  return steps[Math.min(attempt - 1, steps.length - 1)];
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';

export type OutboxKind =
  | 'client.receipt_applied'
  | 'client.receipt_pending'
  | 'client.receipt_rejected'
  | 'client.spend_applied'
  | 'client.dispute_resolved'
  | 'client.bonus_expiry_warning'
  | 'client.bonus_expired'
  | 'staff.shift_flagged'
  | 'staff.shift_forgotten'
  | 'staff.anomaly'
  | 'staff.daily_report';

/**
 * Outbox pattern (TZ-4 §11): a notification is written in the SAME
 * transaction as the business change it describes, so it can never be lost
 * even if Telegram is unreachable at that instant. A separate worker
 * (`outbox.dispatch` job) drains this table independently.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(kind: OutboxKind, payload: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outbox.create({ data: { kind, payload: payload as object } });
  }
}

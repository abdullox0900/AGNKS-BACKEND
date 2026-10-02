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
  | 'client.broadcast'
  | 'staff.shift_flagged'
  | 'staff.shift_forgotten'
  | 'staff.anomaly'
  | 'staff.daily_report'
  | 'staff.cashier_daily';

/** The staff bot is silent except for this one message (a cashier's end-of-day summary). */
export const STAFF_KIND_ALLOWED: OutboxKind = 'staff.cashier_daily';

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
    // Legacy staff notifications (anomalies, forgotten shifts, daily report for admins…) are switched off by
    // product decision — the call sites stay, nothing is queued.
    if (kind.startsWith('staff.') && kind !== STAFF_KIND_ALLOWED) return;
    const client = tx ?? this.prisma;
    await client.outbox.create({ data: { kind, payload: payload as object } });
  }
}

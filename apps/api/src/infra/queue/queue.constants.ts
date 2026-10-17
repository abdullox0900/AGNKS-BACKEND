export const QUEUE_NAMES = {
  outbox: 'outbox.dispatch',
  shiftReconcile: 'shift.reconcile',
  shiftForgotten: 'shift.forgotten',
  ledgerReconcile: 'ledger.reconcile',
  bonusExpire: 'bonus.expire',
  analyticsRefresh: 'analytics.refresh',
  reportDaily: 'report.daily',
  anomalyScan: 'anomaly.scan',
  photosCleanup: 'photos.cleanup',
  idempotencyCleanup: 'idempotency.cleanup',
  broadcastDispatch: 'broadcast.dispatch',
  receiptAutoReview: 'receipt.auto-review',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

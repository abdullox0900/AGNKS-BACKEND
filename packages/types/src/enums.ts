export const ROLES = ['client', 'cashier', 'branch_manager', 'root_admin', 'seo'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ['cashier', 'branch_manager', 'root_admin', 'seo'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles with full-network reach — used where branch_manager's station scope does not apply. */
export const NETWORK_WIDE_ROLES = ['root_admin', 'seo'] as const;
export function isNetworkWideRole(role: StaffRole): boolean {
  return (NETWORK_WIDE_ROLES as readonly StaffRole[]).includes(role);
}

export const LANGS = ['uz', 'ru'] as const;
export type Lang = (typeof LANGS)[number];

export const USER_STATUS = ['active', 'blocked'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const CONSENT_TYPES = ['offer', 'privacy', 'marketing'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const STATION_STATUS = ['active', 'paused', 'closed'] as const;
export type StationStatus = (typeof STATION_STATUS)[number];

export const SHIFT_STATUS = ['open', 'closed', 'reconciling', 'ok', 'flagged'] as const;
export type ShiftStatus = (typeof SHIFT_STATUS)[number];

export const RECEIPT_STATUS = ['applied', 'pending_review', 'rejected'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUS)[number];

export const SPEND_STATUS = ['applied', 'reversed'] as const;
export type SpendStatus = (typeof SPEND_STATUS)[number];

export const LEDGER_TYPE = ['earn', 'spend', 'reverse', 'adjust', 'expire'] as const;
export type LedgerType = (typeof LEDGER_TYPE)[number];

export const LEDGER_REF_TYPE = ['receipt', 'spend', 'dispute', 'manual', 'system'] as const;
export type LedgerRefType = (typeof LEDGER_REF_TYPE)[number];

export const PROMOTION_STATUS = ['scheduled', 'active', 'ended', 'cancelled'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUS)[number];

export const DISPUTE_REF_TYPE = ['receipt', 'spend'] as const;
export type DisputeRefType = (typeof DISPUTE_REF_TYPE)[number];

export const DISPUTE_STATUS = ['open', 'upheld', 'reversed', 'adjusted'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const OUTBOX_STATUS = ['pending', 'sent', 'failed', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUS)[number];

export const LOCATION_POLICY = ['required', 'review', 'off'] as const;
export type LocationPolicy = (typeof LOCATION_POLICY)[number];

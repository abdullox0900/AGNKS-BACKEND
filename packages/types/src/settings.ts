import { z } from 'zod';
import { LOCATION_POLICY } from './enums';

export const SETTINGS_DEFAULTS = {
  'bonus.base_rate_bps': 100,
  'bonus.expiry_days': 180,
  'receipt.max_age_min': 15 * 24 * 60,
  'receipt.min_amount': 10_000,
  'receipt.max_amount': 3_000_000,
  'location.policy': 'off' as const,
  'review.amount_threshold': 1_000_000,
  'review.daily_receipts_threshold': 3,
  'review.random_sample_rate': 0.05,
  'spend.min_amount': 5_000,
  'spend.max_amount': 500_000,
  'spend.daily_limit': 1_000_000,
  'spend.void_window_min': 5,
  'promotion.max_rate_bps': 1000,
  'promotion.warn_rate_bps': 300,
  'anomaly.cashier_avg_multiplier': 2.0,
  'photos.retention_days': 365,
  'report.daily_time': '21:00',
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;

export const settingsSchemas = {
  'bonus.base_rate_bps': z.number().int().min(0).max(10000),
  'bonus.expiry_days': z.number().int().min(0),
  'receipt.max_age_min': z.number().int().min(1),
  'receipt.min_amount': z.number().int().min(0),
  'receipt.max_amount': z.number().int().min(0),
  'location.policy': z.enum(LOCATION_POLICY),
  'review.amount_threshold': z.number().int().min(0),
  'review.daily_receipts_threshold': z.number().int().min(0),
  'review.random_sample_rate': z.number().min(0).max(1),
  'spend.min_amount': z.number().int().min(0),
  'spend.max_amount': z.number().int().min(0),
  'spend.daily_limit': z.number().int().min(0),
  'spend.void_window_min': z.number().int().min(1),
  'promotion.max_rate_bps': z.number().int().min(0).max(10000),
  'promotion.warn_rate_bps': z.number().int().min(0).max(10000),
  'anomaly.cashier_avg_multiplier': z.number().min(1),
  'photos.retention_days': z.number().int().min(1),
  'report.daily_time': z.string().regex(/^\d{2}:\d{2}$/),
} satisfies Record<SettingKey, z.ZodTypeAny>;

export type SettingsMap = { [K in SettingKey]: z.infer<(typeof settingsSchemas)[K]> };

export const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as SettingKey[];

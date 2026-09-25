import { z } from 'zod';
import { STAFF_ROLES, STATION_STATUS, PROMOTION_STATUS } from './enums';
import { moneySchema, bpsSchema, latSchema, lngSchema } from './common';

export const dashboardLoginSchema = z.object({
  phone: z.string().regex(/^\+998\d{9}$/),
  password: z.string().min(6),
});
export type DashboardLoginDto = z.infer<typeof dashboardLoginSchema>;

export const dashboardRecoveryLoginSchema = z.object({
  phone: z.string().regex(/^\+998\d{9}$/),
  recoveryCode: z.string().min(1),
});
export type DashboardRecoveryLoginDto = z.infer<typeof dashboardRecoveryLoginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const createStaffSchema = z.object({
  phone: z.string().regex(/^\+998\d{9}$/),
  firstName: z.string().trim().min(2).max(40),
  role: z.enum(STAFF_ROLES),
  stationId: z.string().uuid().nullable().optional(),
  terminalIds: z.array(z.string().uuid()).optional(),
  // Required for dashboard roles (branch_manager/root_admin/seo) — the creator sets it
  // directly in the form.
  password: z.string().min(6).optional(),
  // Cashier-only: lets the creator pick a PIN the cashier will actually remember,
  // instead of always forcing a random one. Falls back to auto-generated when omitted.
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
});
export type CreateStaffDto = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  firstName: z.string().trim().min(2).max(40).optional(),
  stationId: z.string().uuid().nullable().optional(),
  terminalIds: z.array(z.string().uuid()).optional(),
});
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

export const createStationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(240),
  // Geofencing is off by default (location.policy) — coordinates are optional and
  // only matter if that setting is ever turned back on for a specific deployment.
  lat: latSchema.default(0),
  lng: lngSchema.default(0),
  radiusM: z.coerce.number().int().min(10).max(5000).default(300),
});
export type CreateStationDto = z.infer<typeof createStationSchema>;

export const updateStationSchema = createStationSchema.partial().extend({
  status: z.enum(STATION_STATUS).optional(),
});
export type UpdateStationDto = z.infer<typeof updateStationSchema>;

export const createTerminalSchema = z.object({
  code: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(60),
});
export type CreateTerminalDto = z.infer<typeof createTerminalSchema>;

export const updateTerminalSchema = z.object({
  // The receipt-matching id itself (the "FM ID"/"t=" value printed on a real fiscal
  // check) — editable because a station's fiscal module can be swapped later.
  code: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().min(1).max(60).optional(),
  active: z.boolean().optional(),
});
export type UpdateTerminalDto = z.infer<typeof updateTerminalSchema>;

export const setBaseRateSchema = z.object({
  rateBps: bpsSchema,
  note: z.string().trim().max(300).optional(),
});
export type SetBaseRateDto = z.infer<typeof setBaseRateSchema>;

export const createPromotionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    rateBps: bpsSchema,
    stationIds: z.array(z.string().uuid()).nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().trim().min(2).max(300),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'endsAt must be after startsAt' });
export type CreatePromotionDto = z.infer<typeof createPromotionSchema>;

export const promotionStatusFilterSchema = z.object({
  status: z.enum(PROMOTION_STATUS).optional(),
});

export const impactPreviewSchema = z.object({
  rateBps: bpsSchema,
  stationIds: z.array(z.string().uuid()).nullable(),
});
export type ImpactPreviewDto = z.infer<typeof impactPreviewSchema>;

export const adjustClientSchema = z.object({
  delta: z.coerce.number().int(),
  note: z.string().trim().min(2).max(300),
});
export type AdjustClientDto = z.infer<typeof adjustClientSchema>;

export const reviewRejectSchema = z.object({
  note: z.string().trim().min(2).max(300),
});
export type ReviewRejectDto = z.infer<typeof reviewRejectSchema>;

export const reviewApproveSchema = z.object({
  note: z.string().trim().max(300).optional(),
  // Only used when the receipt's amount is unverified (soliq.uz couldn't confirm it at submit
  // time) — the reviewer checks the fiscal-check link themselves and enters the real amount.
  amount: moneySchema.optional(),
});
export type ReviewApproveDto = z.infer<typeof reviewApproveSchema>;

export const resolveDisputeSchema = z.object({
  resolution: z.enum(['upheld', 'reversed', 'adjusted']),
  amount: moneySchema.optional(),
  note: z.string().trim().min(2).max(300),
});
export type ResolveDisputeDto = z.infer<typeof resolveDisputeSchema>;

export const resolveFeedbackSchema = z.object({
  note: z.string().trim().max(300).optional(),
});
export type ResolveFeedbackDto = z.infer<typeof resolveFeedbackSchema>;

export const removeStaffSchema = z.object({
  // Only required when the target account is a dashboard role (branch_manager/root_admin/seo) —
  // a cashier can be removed without it (see StaffService.remove).
  password: z.string().min(6).optional(),
});
export type RemoveStaffDto = z.infer<typeof removeStaffSchema>;

export const renameClientSchema = z.object({
  firstName: z.string().trim().min(2).max(40),
});
export type RenameClientDto = z.infer<typeof renameClientSchema>;

export const overviewQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  stationIds: z.array(z.string().uuid()).optional(),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const analyticsMetricSchema = z.enum(['receipts', 'bonus', 'clients', 'stations', 'cashiers', 'hours']);
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>;

export const analyticsQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  stationIds: z.array(z.string().uuid()).optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const settingValueSchema = z.object({
  value: z.unknown(),
});

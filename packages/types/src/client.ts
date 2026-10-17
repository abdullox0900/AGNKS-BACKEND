import { z } from 'zod';
import { LANGS, RECEIPT_STATUS } from './enums';
import { moneySchema, latSchema, lngSchema } from './common';

export const registerSchema = z.object({
  firstName: z.string().trim().min(2).max(40),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const updateMeSchema = z.object({
  firstName: z.string().trim().min(2).max(40).optional(),
  lang: z.enum(LANGS).optional(),
  // Manual fallback for when the bot's contact-share flow can't reach the client
  // (e.g. the bot webhook is unreachable) — normally the phone only ever comes
  // through the bot (TZ-4 §7.1); this is a deliberate, explicit exception.
  phone: z
    .string()
    .regex(/^\+998\d{9}$/)
    .optional(),
});
export type UpdateMeDto = z.infer<typeof updateMeSchema>;

export const marketingConsentSchema = z.object({
  accepted: z.boolean(),
  version: z.string().min(1).default('1'),
});
export type MarketingConsentDto = z.infer<typeof marketingConsentSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  phone: z.string().nullable(),
  lang: z.enum(LANGS),
  registered: z.boolean(),
  cardNumber: z.string(),
  balance: z.number().int(),
  pendingAmount: z.number().int(),
  cardBlocked: z.boolean(),
  receiptMinAmount: z.number().int(),
  receiptMaxAmount: z.number().int(),
  spendMinAmount: z.number().int(),
  spendMaxAmount: z.number().int(),
  /** client opted in to promo messages from the bot (active marketing consent) */
  marketingOptIn: z.boolean(),
  /** today's methane price, so'm per m³ (set in Dashboard → Bonus; display only) */
  methanePrice: z.number().int(),
  /** show the "who brought you?" question (new client, feature on, not answered yet) */
  referralAsk: z.boolean(),
  /** why the card is blocked, as written by the SEO (null when not blocked or no reason given) */
  blockedReason: z.string().nullable(),
  /** support threads with a reply the client has not opened yet */
  supportUnread: z.number().int(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const rateResponseSchema = z.object({
  basePercent: z.number(),
  promo: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      percent: z.number(),
      endsAt: z.string(),
    })
    .nullable(),
});
export type RateResponse = z.infer<typeof rateResponseSchema>;

export const parseReceiptSchema = z.object({
  qrText: z.string().min(4).max(500),
});
export type ParseReceiptDto = z.infer<typeof parseReceiptSchema>;

export const manualReceiptFieldsSchema = z.object({
  t: z.string().min(1),
  r: z.string().min(1),
  c: z.string().regex(/^\d{14}$/),
  s: z.string().min(1),
});

export const submitReceiptSchema = z
  .object({
    qrText: z.string().min(4).max(500).optional(),
    manual: manualReceiptFieldsSchema.optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    /**
     * The soliq.uz payment record (`data` of POST new-ofd.soliq.uz/api/payment) as fetched
     * by the webapp from the client's phone. soliq.uz doesn't answer servers outside
     * Uzbekistan, so this is the fallback when the backend's own lookup fails. Checked
     * against the QR (terminal / number / date) before it's trusted.
     */
    soliqData: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => !!v.qrText || !!v.manual, { message: 'qrText or manual is required' });
export type SubmitReceiptDto = z.infer<typeof submitReceiptSchema>;

/** A waiting receipt re-checked later from the client's phone (soliq.uz only answers Uzbek IPs). */
export const recheckReceiptSchema = z.object({
  soliqData: z.record(z.string(), z.unknown()),
});
export type RecheckReceiptDto = z.infer<typeof recheckReceiptSchema>;

export const submitReceiptResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(RECEIPT_STATUS),
  bonus: z.number().int(),
  rateBps: z.number().int(),
  balanceAfter: z.number().int().optional(),
});
export type SubmitReceiptResponse = z.infer<typeof submitReceiptResponseSchema>;

export const spendTokenResponseSchema = z.object({
  code: z.string().length(6),
  qrPayload: z.string(),
  expiresAt: z.string(),
});
export type SpendTokenResponse = z.infer<typeof spendTokenResponseSchema>;

export const disputeCreateSchema = z.object({
  refType: z.enum(['receipt', 'spend']),
  refId: z.string().uuid(),
  claimedAmount: moneySchema.optional(),
  comment: z.string().trim().max(500).optional(),
});
export type DisputeCreateDto = z.infer<typeof disputeCreateSchema>;

/** A general "taklif yoki shikoyat" — not tied to a specific receipt/spend. */
export const feedbackCreateSchema = z.object({
  kind: z.enum(['suggestion', 'complaint']),
  message: z.string().trim().min(2).max(1000),
});
export type FeedbackCreateDto = z.infer<typeof feedbackCreateSchema>;

/** A client's follow-up message inside an existing thread. */
export const feedbackMessageSchema = z.object({
  message: z.string().trim().min(1).max(1000),
});
export type FeedbackMessageDto = z.infer<typeof feedbackMessageSchema>;

/** A new client's answer to "who brought you?": a listed attendant, a typed name, or a skip. */
export const referralAnswerSchema = z
  .object({
    attendantId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(60).optional(),
    skip: z.literal(true).optional(),
  })
  .refine((v) => [v.attendantId, v.name, v.skip].filter((x) => x !== undefined).length === 1, { message: 'exactly_one' });
export type ReferralAnswerDto = z.infer<typeof referralAnswerSchema>;

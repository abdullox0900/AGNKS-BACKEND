import { z } from 'zod';
import { moneySchema } from './common';

export const shiftCloseSchema = z.object({
  declaredTotal: moneySchema,
});
export type ShiftCloseDto = z.infer<typeof shiftCloseSchema>;

export const spendLookupSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type SpendLookupDto = z.infer<typeof spendLookupSchema>;

export const spendLookupResponseSchema = z.object({
  sessionId: z.string().uuid(),
  client: z.object({ name: z.string() }),
  balance: z.number().int(),
  minAmount: z.number().int(),
  maxAmount: z.number().int(),
  dailyRemaining: z.number().int(),
  expiresAt: z.string(),
});
export type SpendLookupResponse = z.infer<typeof spendLookupResponseSchema>;

export const spendSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  amount: moneySchema,
});
export type SpendSubmitDto = z.infer<typeof spendSubmitSchema>;

export const spendVoidSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});
export type SpendVoidDto = z.infer<typeof spendVoidSchema>;

export const pinLoginSchema = z.object({
  phone: z.string().regex(/^\+998\d{9}$/),
  // The cashier's "parol": any 4+ characters (older 6-digit PINs keep working).
  pin: z.string().min(4).max(72),
});
export type PinLoginDto = z.infer<typeof pinLoginSchema>;

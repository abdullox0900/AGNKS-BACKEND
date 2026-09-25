import { z } from 'zod';

export const cursorPageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPage = z.infer<typeof cursorPageSchema>;

export function cursorPageResult<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const moneySchema = z.coerce.number().int().nonnegative();
export const bpsSchema = z.coerce.number().int().min(0).max(10000);
export const latSchema = z.coerce.number().min(-90).max(90);
export const lngSchema = z.coerce.number().min(-180).max(180);

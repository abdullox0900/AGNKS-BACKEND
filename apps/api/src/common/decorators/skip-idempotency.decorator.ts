import { SetMetadata } from '@nestjs/common';

export const SKIP_IDEMPOTENCY_KEY = 'skipIdempotency';

/**
 * Opts a handler or a whole controller out of the global Idempotency-Key
 * requirement. Only for callers that can't send the header and have their own
 * dedup — e.g. Telegram webhooks (Telegram retries by update_id, not by header).
 */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY_KEY, true);

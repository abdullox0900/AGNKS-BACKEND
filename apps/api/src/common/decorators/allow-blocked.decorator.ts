import { SetMetadata } from '@nestjs/common';

export const ALLOW_BLOCKED_KEY = 'allowBlocked';

/**
 * A blocked client is refused everywhere (CARD_BLOCKED) except on routes marked with this: seeing their own
 * profile (with the reason) and writing to support — that is how they ask to be unblocked.
 */
export const AllowBlocked = () => SetMetadata(ALLOW_BLOCKED_KEY, true);

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'AUTH_INVALID_INIT_DATA',
  'AUTH_NOT_REGISTERED',
  'AUTH_STAFF_NOT_FOUND',
  'AUTH_FORBIDDEN',
  'AUTH_2FA_REQUIRED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_LOCKED',
  /** missing, malformed or expired access token — the client should refresh and retry */
  'AUTH_TOKEN_INVALID',
  'CARD_BLOCKED',
  'RECEIPT_QR_INVALID',
  'RECEIPT_TERMINAL_UNKNOWN',
  'RECEIPT_ALREADY_USED',
  'RECEIPT_EXPIRED',
  'RECEIPT_TIME_INVALID',
  'RECEIPT_AMOUNT_OUT_OF_RANGE',
  'RECEIPT_PHOTO_REQUIRED',
  'LOCATION_REQUIRED',
  'LOCATION_TOO_FAR',
  'SPEND_TOKEN_INVALID',
  'SPEND_TOKEN_EXPIRED',
  'SPEND_SESSION_EXPIRED',
  'SPEND_INSUFFICIENT_BALANCE',
  'SPEND_BELOW_MIN',
  'SPEND_ABOVE_MAX',
  'SPEND_DAILY_LIMIT',
  'SHIFT_NOT_OPEN',
  'SHIFT_ALREADY_OPEN',
  'VOID_WINDOW_EXPIRED',
  'DISPUTE_ALREADY_OPEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_INVALID_INIT_DATA: 401,
  AUTH_NOT_REGISTERED: 403,
  AUTH_STAFF_NOT_FOUND: 403,
  AUTH_FORBIDDEN: 403,
  AUTH_2FA_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_LOCKED: 423,
  AUTH_TOKEN_INVALID: 401,
  CARD_BLOCKED: 403,
  RECEIPT_QR_INVALID: 400,
  RECEIPT_TERMINAL_UNKNOWN: 422,
  RECEIPT_ALREADY_USED: 409,
  RECEIPT_EXPIRED: 422,
  RECEIPT_TIME_INVALID: 422,
  RECEIPT_AMOUNT_OUT_OF_RANGE: 422,
  RECEIPT_PHOTO_REQUIRED: 422,
  LOCATION_REQUIRED: 422,
  LOCATION_TOO_FAR: 422,
  SPEND_TOKEN_INVALID: 404,
  SPEND_TOKEN_EXPIRED: 410,
  SPEND_SESSION_EXPIRED: 410,
  SPEND_INSUFFICIENT_BALANCE: 422,
  SPEND_BELOW_MIN: 422,
  SPEND_ABOVE_MAX: 422,
  SPEND_DAILY_LIMIT: 422,
  SHIFT_NOT_OPEN: 409,
  SHIFT_ALREADY_OPEN: 409,
  VOID_WINDOW_EXPIRED: 409,
  DISPUTE_ALREADY_OPEN: 409,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCode;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

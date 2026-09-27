/**
 * Boot-time env checks (ConfigModule `validate`). Fails fast so a misconfigured
 * production deploy never starts serving with an unprotected webhook.
 */

// Telegram's allowed charset/length for setWebhook `secret_token`.
const TELEGRAM_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const isProd = env.NODE_ENV === 'production';
  const secret = typeof env.TELEGRAM_WEBHOOK_SECRET === 'string' ? env.TELEGRAM_WEBHOOK_SECRET.trim() : '';

  if (isProd && !secret) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required when NODE_ENV=production');
  }
  if (secret && !TELEGRAM_SECRET_RE.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, "_" and "-" (1-256 chars)');
  }

  return { ...env, TELEGRAM_WEBHOOK_SECRET: secret };
}

import { Logger } from '@nestjs/common';
import type { Bot } from 'grammy';

/** Key of the original bot (TELEGRAM_CLIENT_BOT_TOKEN) — it keeps working exactly as before. */
export const MAIN_BOT_KEY = 'main';

const KEY_RE = /^[a-z0-9_]{1,32}$/;
const logger = new Logger('ClientBots');

export interface ClientBotToken {
  key: string;
  token: string;
}

export interface ClientBotEntry extends ClientBotToken {
  bot: Bot;
}

/**
 * Tokens of the additional per-station client bots, from TELEGRAM_EXTRA_BOT_TOKENS:
 *   `kokand=123456:AAA...,quva=654321:BBB...`   (key = a-z 0-9 _, then "=", then the token)
 * A malformed or duplicate entry is skipped with an error in the log — a typo here must never
 * take the main bot down with it.
 */
export function parseExtraBotTokens(raw: string | undefined): ClientBotToken[] {
  const out: ClientBotToken[] = [];
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    const key = eq > 0 ? part.slice(0, eq).trim().toLowerCase() : '';
    const token = eq > 0 ? part.slice(eq + 1).trim() : '';
    if (!KEY_RE.test(key) || key === MAIN_BOT_KEY || !/^\d+:[\w-]{20,}$/.test(token)) {
      logger.error(`TELEGRAM_EXTRA_BOT_TOKENS: entry "${key || '?'}" is malformed or uses a reserved key — skipped`);
      continue;
    }
    if (out.some((b) => b.key === key || b.token === token)) {
      logger.error(`TELEGRAM_EXTRA_BOT_TOKENS: duplicate key or token for "${key}" — skipped`);
      continue;
    }
    out.push({ key, token });
  }
  return out;
}

/** Main bot first, then the extras. Used by both the bot registry and initData validation. */
export function clientBotTokens(mainToken: string | undefined, extraRaw: string | undefined): ClientBotToken[] {
  const extras = parseExtraBotTokens(extraRaw).filter((b) => b.token !== mainToken);
  return mainToken ? [{ key: MAIN_BOT_KEY, token: mainToken }, ...extras] : extras;
}

/** All client bots (the original one plus one per station), addressable by key. */
export class ClientBotRegistry {
  constructor(private readonly entries: ClientBotEntry[]) {}

  all(): ClientBotEntry[] {
    return this.entries;
  }

  get(key: string | null | undefined): ClientBotEntry | undefined {
    return key ? this.entries.find((e) => e.key === key) : undefined;
  }

  /** The bot to use when a person has no bot of their own recorded yet. */
  fallback(): ClientBotEntry | undefined {
    return this.get(MAIN_BOT_KEY) ?? this.entries[0];
  }
}

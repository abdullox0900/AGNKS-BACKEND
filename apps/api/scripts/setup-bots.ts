/**
 * Points the per-station client bots at this server and at the webapp.
 *
 *   pnpm bots:setup --api https://api.metango.uz --app https://klient.example.com            # all station bots
 *   pnpm bots:setup --api ... --app ... --only kokand,quva                                    # some of them
 *   pnpm bots:setup --api ... --app ... --dry                                                 # print, change nothing
 *   pnpm bots:setup --api ... --app ... --include-main                                        # also (re)point the original bot
 *
 * Tokens come from .env (TELEGRAM_EXTRA_BOT_TOKENS / TELEGRAM_CLIENT_BOT_TOKEN) and are never printed.
 * For every bot it sets:
 *   - the webhook  →  <api>/api/v1/webhook/client-bot/<key>   (with TELEGRAM_WEBHOOK_SECRET as secret_token)
 *   - the menu button → <app>/?b=<key>   (the webapp reads "b" to pick this station's colors)
 * The original bot is left alone unless --include-main is given (its webhook is already set).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bot } from 'grammy';
import { clientBotTokens, MAIN_BOT_KEY } from '../src/infra/telegram/client-bots';

function loadEnv(file: string) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnv(resolve(process.cwd(), '.env'));
  const api = arg('api')?.replace(/\/+$/, '');
  const app = arg('app')?.replace(/\/+$/, '');
  const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const dry = flag('dry');
  if (!api || !app || !/^https:\/\//.test(api) || !/^https:\/\//.test(app)) {
    console.error('Usage: pnpm bots:setup --api https://api.example.uz --app https://app.example.uz [--only a,b] [--include-main] [--dry]');
    process.exit(1);
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret) console.warn('! TELEGRAM_WEBHOOK_SECRET is empty — the webhook would be unprotected');

  const all = clientBotTokens(process.env.TELEGRAM_CLIENT_BOT_TOKEN, process.env.TELEGRAM_EXTRA_BOT_TOKENS);
  const bots = all.filter((b) => (b.key !== MAIN_BOT_KEY || flag('include-main')) && (!only || only.includes(b.key)));
  if (bots.length === 0) {
    console.error('No bots to set up. Put the station bots into TELEGRAM_EXTRA_BOT_TOKENS (key=token,key=token) in .env first.');
    process.exit(1);
  }

  let failed = 0;
  for (const { key, token } of bots) {
    const hook = key === MAIN_BOT_KEY ? `${api}/api/v1/webhook/client-bot` : `${api}/api/v1/webhook/client-bot/${key}`;
    const url = key === MAIN_BOT_KEY ? app : `${app}/?b=${key}`;
    try {
      const bot = new Bot(token);
      const me = await bot.api.getMe();
      console.log(`${key}: @${me.username}`);
      console.log(`   webhook     ${hook}`);
      console.log(`   menu button ${url}`);
      if (dry) continue;
      await bot.api.setWebhook(hook, { secret_token: secret || undefined, allowed_updates: ['message', 'callback_query'] });
      await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Ilovani ochish', web_app: { url } } });
      console.log('   ok');
    } catch (err) {
      failed++;
      console.error(`${key}: FAILED — ${(err as Error).message}`);
    }
  }
  if (dry) console.log('(dry run — nothing was changed)');
  process.exit(failed ? 1 : 0);
}

void main();

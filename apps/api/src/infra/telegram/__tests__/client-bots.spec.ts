import { createHmac } from 'node:crypto';
import { ClientBotRegistry, clientBotTokens, parseExtraBotTokens } from '../client-bots';
import { TelegramInitDataService } from '../init-data.service';

const MAIN = '111111:MAIN_TOKEN_aaaaaaaaaaaaaaaaaaaaaaaa';
const KOKAND = '222222:KOKAND_TOKEN_bbbbbbbbbbbbbbbbbbbbbb';
const QUVA = '333333:QUVA_TOKEN_cccccccccccccccccccccccc';

function sign(token: string, user = { id: 7, first_name: 'Ali' }, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'q', user: JSON.stringify(user) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function service(env: Record<string, string | undefined>) {
  const config = { get: (k: string, d?: unknown) => env[k] ?? d };
  return new TelegramInitDataService(config as never);
}

describe('parseExtraBotTokens', () => {
  it('reads key=token pairs', () => {
    expect(parseExtraBotTokens(`kokand=${KOKAND}, quva=${QUVA}`)).toEqual([
      { key: 'kokand', token: KOKAND },
      { key: 'quva', token: QUVA },
    ]);
  });

  it('skips malformed, reserved and duplicate entries instead of failing', () => {
    const out = parseExtraBotTokens(`main=${KOKAND},bad,Beshariq=${QUVA},x=notatoken,beshariq=${KOKAND},kokand=${QUVA}`);
    expect(out.map((b) => b.key)).toEqual(['beshariq']); // "main" reserved, "x" bad token, "kokand" reuses beshariq's token
  });

  it('is empty when unset', () => {
    expect(parseExtraBotTokens(undefined)).toEqual([]);
    expect(parseExtraBotTokens('')).toEqual([]);
  });
});

describe('clientBotTokens', () => {
  it('puts the main bot first and ignores an extra that repeats it', () => {
    expect(clientBotTokens(MAIN, `kokand=${KOKAND},again=${MAIN}`).map((b) => b.key)).toEqual(['main', 'kokand']);
  });
  it('works with only extras, or nothing', () => {
    expect(clientBotTokens(undefined, `kokand=${KOKAND}`).map((b) => b.key)).toEqual(['kokand']);
    expect(clientBotTokens(undefined, undefined)).toEqual([]);
  });
});

describe('TelegramInitDataService — several client bots', () => {
  const env = { TELEGRAM_CLIENT_BOT_TOKEN: MAIN, TELEGRAM_EXTRA_BOT_TOKENS: `kokand=${KOKAND},quva=${QUVA}`, TELEGRAM_STAFF_BOT_TOKEN: '444444:STAFF_TOKEN_dddddddddddddddddddddd' };

  it('accepts data signed by the main bot, and says so', () => {
    const parsed = service(env).validate(sign(MAIN), 'client');
    expect(parsed.botKey).toBe('main');
    expect(parsed.user.id).toBe(7);
  });

  it('accepts data signed by a station bot and reports which one', () => {
    expect(service(env).validate(sign(QUVA), 'client').botKey).toBe('quva');
    expect(service(env).validate(sign(KOKAND), 'client').botKey).toBe('kokand');
  });

  it('rejects data signed by a bot we do not know, or tampered data', () => {
    const stranger = '999999:STRANGER_TOKEN_eeeeeeeeeeeeeeeeeeeeee';
    expect(() => service(env).validate(sign(stranger), 'client')).toThrow();
    const tampered = sign(KOKAND).replace('Ali', 'Eve');
    expect(() => service(env).validate(tampered, 'client')).toThrow();
  });

  it('still validates with only the original token (existing deployments)', () => {
    const only = { TELEGRAM_CLIENT_BOT_TOKEN: MAIN };
    expect(service(only).validate(sign(MAIN), 'client').botKey).toBe('main');
    expect(() => service(only).validate(sign(QUVA), 'client')).toThrow();
  });

  it('the staff kind only accepts the staff bot', () => {
    expect(service(env).validate(sign(env.TELEGRAM_STAFF_BOT_TOKEN), 'staff').botKey).toBe('staff');
    expect(() => service(env).validate(sign(QUVA), 'staff')).toThrow();
  });

  it('rejects expired data', () => {
    expect(() => service(env).validate(sign(MAIN, undefined, 1000), 'client')).toThrow();
  });
});

describe('ClientBotRegistry', () => {
  const entry = (key: string) => ({ key, token: key, bot: {} as never });
  it('finds a bot by key and falls back to main, then to the first', () => {
    const r = new ClientBotRegistry([entry('kokand'), entry('main')]);
    expect(r.get('kokand')?.key).toBe('kokand');
    expect(r.get('nope')).toBeUndefined();
    expect(r.fallback()?.key).toBe('main');
    expect(new ClientBotRegistry([entry('kokand')]).fallback()?.key).toBe('kokand');
  });
});

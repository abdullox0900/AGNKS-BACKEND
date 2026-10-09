import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@agnks/types';
import { clientBotTokens } from './client-bots';

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  user: TelegramInitDataUser;
  authDate: number;
  raw: URLSearchParams;
  /** which bot signed it: 'main' / a station key for client data, 'staff' for the staff bot */
  botKey: string;
}

export type InitDataBotKind = 'client' | 'staff';

/**
 * Validates Telegram WebApp `initData` per the Mini Apps spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
@Injectable()
export class TelegramInitDataService {
  constructor(private readonly config: ConfigService) {}

  validate(initData: string, botKind: InitDataBotKind): ParsedInitData {
    if (!initData) {
      throw new AppError('AUTH_INVALID_INIT_DATA');
    }

    const candidates = this.tokensFor(botKind);
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      throw new AppError('AUTH_INVALID_INIT_DATA');
    }

    const pairs: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key === 'hash') continue;
      pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    // The data is signed with the token of whichever bot opened the app — try each configured one.
    const signer = candidates.find(({ token }) => {
      const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
      const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      return computed.length === hash.length && timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
    });
    if (!signer) {
      throw new AppError('AUTH_INVALID_INIT_DATA');
    }

    const authDate = Number(params.get('auth_date') ?? '0');
    const maxAgeS = this.config.get<number>('TELEGRAM_INIT_DATA_MAX_AGE_S', 86400);
    const ageS = Date.now() / 1000 - authDate;
    if (!authDate || ageS > maxAgeS || ageS < -60) {
      throw new AppError('AUTH_INVALID_INIT_DATA', { reason: 'expired' });
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      throw new AppError('AUTH_INVALID_INIT_DATA', { reason: 'missing_user' });
    }

    let user: TelegramInitDataUser;
    try {
      user = JSON.parse(userRaw) as TelegramInitDataUser;
    } catch {
      throw new AppError('AUTH_INVALID_INIT_DATA', { reason: 'malformed_user' });
    }

    return { user, authDate, raw: params, botKey: signer.key };
  }

  private tokensFor(kind: InitDataBotKind): { key: string; token: string }[] {
    const tokens =
      kind === 'client'
        ? clientBotTokens(this.config.get<string>('TELEGRAM_CLIENT_BOT_TOKEN'), this.config.get<string>('TELEGRAM_EXTRA_BOT_TOKENS'))
        : [{ key: 'staff', token: this.config.get<string>('TELEGRAM_STAFF_BOT_TOKEN') ?? '' }].filter((t) => t.token);
    if (tokens.length === 0) {
      throw new AppError('INTERNAL_ERROR', { reason: `${kind === 'client' ? 'TELEGRAM_CLIENT_BOT_TOKEN' : 'TELEGRAM_STAFF_BOT_TOKEN'} not configured` });
    }
    return tokens;
  }
}

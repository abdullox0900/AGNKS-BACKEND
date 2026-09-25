import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AppError } from '@agnks/types';

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

    const botToken = this.tokenFor(botKind);
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

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) {
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

    return { user, authDate, raw: params };
  }

  private tokenFor(kind: InitDataBotKind): string {
    const key = kind === 'client' ? 'TELEGRAM_CLIENT_BOT_TOKEN' : 'TELEGRAM_STAFF_BOT_TOKEN';
    const token = this.config.get<string>(key);
    if (!token) {
      throw new AppError('INTERNAL_ERROR', { reason: `${key} not configured` });
    }
    return token;
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppError, type StaffRole } from '@agnks/types';

export interface StaffTokenPayload {
  sub: string;
  role: StaffRole;
  stationId: string | null;
  terminalIds: string[];
  type: 'access' | 'refresh';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccess(payload: Omit<StaffTokenPayload, 'type'>, ttl: string): string {
    return this.jwt.sign(
      { ...payload, type: 'access' },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: ttl },
    );
  }

  signRefresh(payload: Omit<StaffTokenPayload, 'type'>, ttl: string): string {
    return this.jwt.sign(
      { ...payload, type: 'refresh' },
      { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: ttl },
    );
  }

  verifyAccess(token: string): StaffTokenPayload {
    return this.verify(token, this.config.get<string>('JWT_ACCESS_SECRET')!, 'access');
  }

  verifyRefresh(token: string): StaffTokenPayload {
    return this.verify(token, this.config.get<string>('JWT_REFRESH_SECRET')!, 'refresh');
  }

  private verify(token: string, secret: string, expectedType: 'access' | 'refresh'): StaffTokenPayload {
    let payload: StaffTokenPayload;
    try {
      payload = this.jwt.verify<StaffTokenPayload>(token, { secret });
    } catch {
      // 401 (not 403) so the webapps' interceptors refresh the access token and retry.
      throw new AppError('AUTH_TOKEN_INVALID', { reason: 'invalid_token' });
    }
    if (payload.type !== expectedType) {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'wrong_token_type' });
    }
    return payload;
  }
}

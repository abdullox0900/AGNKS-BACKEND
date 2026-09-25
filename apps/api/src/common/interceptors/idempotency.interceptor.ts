import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Observable, firstValueFrom, from } from 'rxjs';
import { AppError } from '@agnks/types';
import { RedisService } from '@/infra/redis/redis.service';
import { PrismaService } from '@/infra/prisma/prisma.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TTL_SECONDS = 24 * 60 * 60;

interface StoredResult {
  statusCode: number;
  bodyHash: string;
  response: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!WRITE_METHODS.has(request.method)) {
      return firstValueFrom(next.handle());
    }

    const key = request.header('Idempotency-Key');
    if (!key) {
      throw new AppError('VALIDATION_ERROR', { message: 'Idempotency-Key header is required' });
    }

    const bodyHash = hashBody(request.body);
    const cached = await this.lookup(key);

    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT');
      }
      return cached.response;
    }

    const response = await firstValueFrom(next.handle());
    await this.store(key, request.method, request.path, bodyHash, response);
    return response;
  }

  private async lookup(key: string): Promise<StoredResult | null> {
    const cached = await this.redis.safeGet(`idem:${key}`);
    if (cached) {
      try {
        return JSON.parse(cached) as StoredResult;
      } catch {
        /* fall through to DB */
      }
    }

    const row = await this.prisma.idempotencyKey.findUnique({ where: { key } }).catch(() => null);
    if (!row) return null;

    const result: StoredResult = { statusCode: row.statusCode, bodyHash: row.bodyHash, response: row.response };
    await this.redis.safeSet(`idem:${key}`, JSON.stringify(result), TTL_SECONDS);
    return result;
  }

  private async store(key: string, method: string, path: string, bodyHash: string, response: unknown): Promise<void> {
    const record: StoredResult = { statusCode: 200, bodyHash, response };
    await Promise.all([
      this.redis.safeSet(`idem:${key}`, JSON.stringify(record), TTL_SECONDS),
      this.prisma.idempotencyKey
        .upsert({
          where: { key },
          create: { key, method, path, bodyHash, statusCode: 200, response: response as object },
          update: {},
        })
        .catch(() => undefined),
    ]);
  }
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

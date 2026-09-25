import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, type ApiFailure } from '@agnks/types';
import { ZodError } from 'zod';

/**
 * Every exception thrown anywhere in the app lands here and is turned into
 * a structured { ok: false, error } response. Nothing escapes this filter,
 * so a single bad request/bug can never crash the process or take down
 * other in-flight requests.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.toResponse(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiFailure } {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        body: { ok: false, error: { code: exception.code, details: exception.details } },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: {
          ok: false,
          error: { code: 'VALIDATION_ERROR', details: { issues: exception.issues } },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === HttpStatus.NOT_FOUND ? 'NOT_FOUND' : this.codeForHttpStatus(status);
      return { status, body: { ok: false, error: { code, details: { message: exception.message } } } };
    }

    return {
      status: 500,
      body: { ok: false, error: { code: 'INTERNAL_ERROR' } },
    };
  }

  private codeForHttpStatus(status: number): 'VALIDATION_ERROR' | 'AUTH_FORBIDDEN' | 'RATE_LIMITED' | 'INTERNAL_ERROR' {
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 403) return 'AUTH_FORBIDDEN';
    if (status === 429) return 'RATE_LIMITED';
    return 'INTERNAL_ERROR';
  }
}

import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    // Let ZodError escape — GlobalExceptionFilter turns it into a
    // VALIDATION_ERROR response with the field-level issues attached.
    return this.schema.parse(value);
  }
}

import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

/**
 * Default ValidationPipe configuration used by both BFF and microservices.
 * Centralised so every entry point applies identical input rules.
 */
export const DEFAULT_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: 422,
};

export function createValidationPipe(options?: ValidationPipeOptions): ValidationPipe {
  return new ValidationPipe({
    ...DEFAULT_VALIDATION_PIPE_OPTIONS,
    ...options,
  });
}

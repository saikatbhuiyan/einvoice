import { ArgumentsHost, Catch, ExceptionFilter, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Returns a failed health check's body exactly as terminus built it (`status`, `info`, `error`,
 * `details` -- which check failed and why) instead of letting an app-wide exception filter
 * reformat it. Without this, bff's GlobalExceptionFilter turned a failing readiness check into a
 * generic problem+json "Service Unavailable Exception" with no indication of *which* dependency
 * was down. Apply it to a health controller with `@UseFilters(...)`; controller-scoped filters
 * take precedence over global ones, so other routes keep the app's normal error format.
 */
@Catch(ServiceUnavailableException)
export class HealthCheckExceptionFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { ORGANIZATION_HEADER } from '@libs/shared/types';
import { problem, statusTitle } from '@libs/shared/utils';

/**
 * For the services' internal HTTP APIs: a tenant-scoped route reached without a (valid)
 * X-Organization-Id header is the caller's mistake, so a 400 that names the header -- not the 500
 * an unmapped error would be. (bff never gets here: its PermissionGuard resolves the organization
 * before any tenant route runs. RPC calls are mapped by RpcExceptionInterceptor instead.)
 */
@Catch(MissingOrganizationContextError)
export class MissingOrganizationContextFilter implements ExceptionFilter {
  catch(_exception: MissingOrganizationContextError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const status = HttpStatus.BAD_REQUEST;
    ctx
      .getResponse<Response>()
      .status(status)
      .type('application/problem+json')
      .json(
        problem(
          statusTitle(status),
          `This route needs the organization: send a UUID in the ${ORGANIZATION_HEADER} header.`,
          status,
          {
            instance: ctx.getRequest<Request>().url,
          },
        ),
      );
  }
}

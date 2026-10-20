import { Injectable } from '@nestjs/common';
import { ORGANIZATION_HEADER, type CorrelatedRequest } from '@libs/shared/types';
import type { CorrelationContext } from '@libs/logging';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For the services' *internal* HTTP APIs only (invoice, product, user-access, payment -- reached
 * directly, never through bff): the organization is taken from the X-Organization-Id header as-is,
 * so tenant-scoped handlers can run. These ports are unauthenticated and trusted by network
 * placement (not published in prod), exactly as before tenancy.
 *
 * Never use this in bff: there the organization must be validated against the caller's
 * memberships (PermissionGuard), not believed from a header.
 */
@Injectable()
export class InternalCallerContextMiddleware extends CorrelationIdMiddleware {
  protected override callerContext(req: CorrelatedRequest): Partial<CorrelationContext> {
    const header = req.headers[ORGANIZATION_HEADER];
    const organizationId = Array.isArray(header) ? header[0] : header;
    return organizationId && UUID.test(organizationId) ? { organizationId } : {};
  }
}

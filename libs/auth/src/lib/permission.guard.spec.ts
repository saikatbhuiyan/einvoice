import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { getCurrentCorrelationContext, runWithCorrelationContext } from '@libs/logging';
import type { AuthenticatedUser } from './authenticated-user.interface';
import { PermissionGuard } from './permission.guard';
import type { PermissionResolver } from './permission-resolver.interface';
import { RequirePermission } from './require-permission.decorator';

@Controller()
class Routes {
  @Get('open')
  open() {
    return null;
  }

  @RequirePermission('invoice:write')
  @Get('write')
  write() {
    return null;
  }
}

function httpContext(method: keyof Routes, user?: AuthenticatedUser) {
  const request = { user };
  const host = new ExecutionContextHost([request, {}, () => undefined], Routes, Routes.prototype[method]);
  host.setType('http');
  return { host, request };
}

const accountant = (): AuthenticatedUser => ({ sub: 'u-1', username: 'dev.accountant', roles: ['accountant'] });

describe('PermissionGuard', () => {
  let resolver: jest.Mocked<PermissionResolver>;
  let guard: PermissionGuard;

  beforeEach(() => {
    resolver = { getPermissionsForRoles: jest.fn().mockResolvedValue(['invoice:read']) };
    guard = new PermissionGuard(new Reflector(), resolver);
  });

  it('lets a @Public() route through without resolving anything (no user on the request)', async () => {
    await expect(guard.canActivate(httpContext('write').host)).resolves.toBe(true);
    expect(resolver.getPermissionsForRoles).not.toHaveBeenCalled();
  });

  it('resolves permissions for every authenticated request, even on routes with no requirement', async () => {
    const { host, request } = httpContext('open', accountant());

    await expect(guard.canActivate(host)).resolves.toBe(true);

    expect(resolver.getPermissionsForRoles).toHaveBeenCalledWith(['accountant']);
    expect(request.user?.permissions).toEqual(['invoice:read']);
  });

  it('pushes resolved permissions onto the correlation context, so outgoing RpcEnvelopes carry them', async () => {
    const { host } = httpContext('open', accountant());

    const propagated = await runWithCorrelationContext({ correlationId: 'c', traceId: 't' }, async () => {
      await guard.canActivate(host);
      return getCurrentCorrelationContext()?.permissions;
    });

    expect(propagated).toEqual(['invoice:read']);
  });

  it('allows a route whose requirement is satisfied', async () => {
    resolver.getPermissionsForRoles.mockResolvedValue(['invoice:read', 'invoice:write']);

    await expect(guard.canActivate(httpContext('write', accountant()).host)).resolves.toBe(true);
  });

  it('throws 403 naming the missing permission when the requirement is not met', async () => {
    const attempt = guard.canActivate(httpContext('write', accountant()).host);

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow('Missing required permission(s): invoice:write.');
  });

  // Documents current behavior rather than endorsing it: a resolver failure (Authorizer
  // unreachable) is not translated to a 503 here — see docs/grpc-bff-to-authorizer-communication.md.
  it('propagates a resolver failure unchanged', async () => {
    resolver.getPermissionsForRoles.mockRejectedValue(new Error('14 UNAVAILABLE'));

    await expect(guard.canActivate(httpContext('open', accountant()).host)).rejects.toThrow('14 UNAVAILABLE');
  });
});

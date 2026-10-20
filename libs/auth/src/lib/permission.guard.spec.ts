import { BadRequestException, Controller, ForbiddenException, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { getCurrentCorrelationContext, runWithCorrelationContext } from '@libs/logging';
import type { AuthenticatedUser } from './authenticated-user.interface';
import { PermissionGuard } from './permission.guard';
import type { CallerResolution, PermissionResolver } from './permission-resolver.interface';
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

  @RequirePermission('platform:admin')
  @Get('platform')
  platform() {
    return null;
  }
}

function httpContext(method: keyof Routes, user?: AuthenticatedUser, headers: Record<string, string> = {}) {
  const request = { user, headers };
  const host = new ExecutionContextHost([request, {}, () => undefined], Routes, Routes.prototype[method]);
  host.setType('http');
  return { host, request };
}

const caller = (): AuthenticatedUser => ({ sub: 'kc-1', username: 'jane', roles: ['platform-admin'] });

const MEMBERSHIPS = [
  { organizationId: 'org-acme', organizationName: 'Acme', roleName: 'accountant' },
  { organizationId: 'org-globex', organizationName: 'Globex', roleName: 'viewer' },
];

const resolved = (permissions: string[], organizationId = 'org-acme'): CallerResolution => ({
  status: 'resolved',
  organizationId,
  roleName: 'accountant',
  permissions,
  memberships: MEMBERSHIPS,
});

describe('PermissionGuard', () => {
  let resolver: jest.Mocked<PermissionResolver>;
  let guard: PermissionGuard;

  beforeEach(() => {
    resolver = { resolveCaller: jest.fn().mockResolvedValue(resolved(['invoice:read'])) };
    guard = new PermissionGuard(new Reflector(), resolver);
  });

  it('lets a @Public() route through without resolving anything (no user on the request)', async () => {
    await expect(guard.canActivate(httpContext('write').host)).resolves.toBe(true);
    expect(resolver.resolveCaller).not.toHaveBeenCalled();
  });

  it('resolves the caller for every authenticated request, even on routes with no requirement', async () => {
    const { host, request } = httpContext('open', caller());

    await expect(guard.canActivate(host)).resolves.toBe(true);

    expect(resolver.resolveCaller).toHaveBeenCalledWith({ userId: 'kc-1', roles: ['platform-admin'] }, undefined);
    expect(request.user).toMatchObject({
      permissions: ['invoice:read'],
      organizationId: 'org-acme',
      memberships: MEMBERSHIPS,
    });
  });

  it('passes the X-Organization-Id header to the resolver, trimmed', async () => {
    await guard.canActivate(httpContext('open', caller(), { 'x-organization-id': ' org-globex ' }).host);

    expect(resolver.resolveCaller).toHaveBeenCalledWith(expect.anything(), 'org-globex');
  });

  // Every outgoing RpcEnvelope is built from this context: downstream services scope by it.
  it('puts the resolved organization and permissions on the correlation context', async () => {
    const propagated = await runWithCorrelationContext({ correlationId: 'c', traceId: 't' }, async () => {
      await guard.canActivate(httpContext('open', caller()).host);
      const context = getCurrentCorrelationContext();
      return { organizationId: context?.organizationId, permissions: context?.permissions };
    });

    expect(propagated).toEqual({ organizationId: 'org-acme', permissions: ['invoice:read'] });
  });

  // The header is a request, never trusted: the resolver checks it against the memberships.
  it('rejects an organization the caller does not belong to, even on a route with no requirement', async () => {
    resolver.resolveCaller.mockResolvedValue({ status: 'not_member', permissions: [], memberships: MEMBERSHIPS });

    await expect(
      guard.canActivate(httpContext('open', caller(), { 'x-organization-id': 'org-other' }).host),
    ).rejects.toThrow(new ForbiddenException('You are not a member of organization "org-other".'));
  });

  it('asks a member of several organizations to choose one, instead of reporting a missing permission', async () => {
    resolver.resolveCaller.mockResolvedValue({ status: 'ambiguous', permissions: [], memberships: MEMBERSHIPS });

    await expect(guard.canActivate(httpContext('write', caller()).host)).rejects.toThrow(
      new BadRequestException('You belong to several organizations; choose one with the x-organization-id header.'),
    );
  });

  it('tells someone in no organization that they belong nowhere', async () => {
    resolver.resolveCaller.mockResolvedValue({ status: 'none', permissions: [], memberships: [] });

    await expect(guard.canActivate(httpContext('write', caller()).host)).rejects.toThrow(
      new ForbiddenException('You are not a member of any organization.'),
    );
  });

  it('lets an unresolved caller use routes that need no organization (e.g. GET /me)', async () => {
    resolver.resolveCaller.mockResolvedValue({ status: 'ambiguous', permissions: [], memberships: MEMBERSHIPS });

    await expect(guard.canActivate(httpContext('open', caller()).host)).resolves.toBe(true);
  });

  it('allows a platform route without any organization', async () => {
    resolver.resolveCaller.mockResolvedValue({ status: 'none', permissions: ['platform:admin'], memberships: [] });

    await expect(guard.canActivate(httpContext('platform', caller()).host)).resolves.toBe(true);
  });

  it('allows a route whose requirement is satisfied in the active organization', async () => {
    resolver.resolveCaller.mockResolvedValue(resolved(['invoice:read', 'invoice:write']));

    await expect(guard.canActivate(httpContext('write', caller()).host)).resolves.toBe(true);
  });

  it('rejects a route whose requirement is not satisfied, naming what is missing', async () => {
    await expect(guard.canActivate(httpContext('write', caller()).host)).rejects.toThrow(
      new ForbiddenException('Missing required permission(s): invoice:write.'),
    );
  });
});

import { Controller } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { GrpcMethod, MessagePattern, RpcException } from '@nestjs/microservices';
import { GrpcStatus } from '@libs/interceptors';
import { runWithCorrelationContext } from '@libs/logging';
import { createRpcEnvelope } from '@libs/transports';
import { Public } from './public.decorator';
import { RequirePermission } from './require-permission.decorator';
import { RpcPermissionGuard } from './rpc-permission.guard';

@Controller()
class TcpHandlers {
  @MessagePattern('open')
  open() {
    return null;
  }

  @RequirePermission('invoice:read')
  @MessagePattern('read')
  read() {
    return null;
  }

  @RequirePermission('invoice:read', 'invoice:write')
  @MessagePattern('readWrite')
  readWrite() {
    return null;
  }

  @Public()
  @MessagePattern('public')
  publicHandler() {
    return null;
  }
}

@RequirePermission('product:read')
@Controller()
class ClassGated {
  @MessagePattern('inherits')
  inherits() {
    return null;
  }

  @RequirePermission('product:write')
  @MessagePattern('overrides')
  overrides() {
    return null;
  }
}

@Controller()
class GrpcHandlers {
  @Public()
  @GrpcMethod('RoleQueryService', 'FindAllRoles')
  publicGrpc() {
    return null;
  }

  @GrpcMethod('RoleQueryService', 'Guarded')
  guardedGrpc() {
    return null;
  }
}

type HandlerClass = new () => object;

function rpcContext(cls: HandlerClass, method: string, payload: unknown, type: 'rpc' | 'http' = 'rpc') {
  const handler = (cls.prototype as Record<string, () => unknown>)[method];
  const host = new ExecutionContextHost([payload, undefined], cls, handler);
  host.setType(type);
  return host;
}

// Builds an envelope exactly the way a real caller does — createRpcEnvelope() reads identity from
// the active correlation context — then round-trips it through JSON the way the TCP transport does.
function envelope(data: unknown, identity: { userId?: string; permissions?: string[] } = {}) {
  const built = runWithCorrelationContext({ correlationId: 'corr-1', traceId: 'trace-1', ...identity }, () =>
    createRpcEnvelope(data, 'bff'),
  );
  return JSON.parse(JSON.stringify(built)) as unknown;
}

function rpcError(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RpcException);
    return (error as RpcException).getError() as Record<string, unknown>;
  }
  throw new Error('expected the guard to throw');
}

describe('RpcPermissionGuard', () => {
  const guard = new RpcPermissionGuard(new Reflector());

  it('ignores non-RPC contexts entirely', () => {
    expect(guard.canActivate(rpcContext(TcpHandlers, 'read', undefined, 'http'))).toBe(true);
  });

  describe('identity', () => {
    it('rejects a raw, un-enveloped message as unauthenticated, even on a handler with no permission requirement', () => {
      const error = rpcError(() => guard.canActivate(rpcContext(TcpHandlers, 'open', { id: 'x' })));

      expect(error).toMatchObject({ code: GrpcStatus.UNAUTHENTICATED, status: 401, error: 'Unauthorized' });
    });

    it('rejects an envelope with no userId (bff sent it before any user was authenticated)', () => {
      const error = rpcError(() => guard.canActivate(rpcContext(TcpHandlers, 'open', envelope({ id: 'x' }))));

      expect(error['code']).toBe(GrpcStatus.UNAUTHENTICATED);
    });

    it('rejects a payload that only looks like an envelope (meta without a correlationId)', () => {
      const forged = { data: {}, meta: { userId: 'u-1', permissions: ['invoice:read'] } };

      const error = rpcError(() => guard.canActivate(rpcContext(TcpHandlers, 'read', forged)));

      expect(error['code']).toBe(GrpcStatus.UNAUTHENTICATED);
    });

    it('accepts an enveloped call with no data key at all — JSON drops `data: undefined` on the wire', () => {
      const wire = envelope(undefined, { userId: 'u-1' }) as Record<string, unknown>;
      expect('data' in wire).toBe(false);

      expect(guard.canActivate(rpcContext(TcpHandlers, 'open', wire))).toBe(true);
    });
  });

  describe('permissions', () => {
    it('allows an authenticated caller on a handler with no @RequirePermission', () => {
      expect(guard.canActivate(rpcContext(TcpHandlers, 'open', envelope({}, { userId: 'u-1' })))).toBe(true);
    });

    it('allows a caller holding the required permission', () => {
      const payload = envelope({}, { userId: 'u-1', permissions: ['invoice:read'] });

      expect(guard.canActivate(rpcContext(TcpHandlers, 'read', payload))).toBe(true);
    });

    it('denies with PERMISSION_DENIED/403 and names every missing permission', () => {
      const payload = envelope({}, { userId: 'u-1', permissions: ['product:read'] });

      const error = rpcError(() => guard.canActivate(rpcContext(TcpHandlers, 'readWrite', payload)));

      expect(error).toMatchObject({
        code: GrpcStatus.PERMISSION_DENIED,
        status: 403,
        message: 'Missing required permission(s): invoice:read, invoice:write.',
      });
    });

    it('treats an envelope with no permissions array as holding none', () => {
      const error = rpcError(() => guard.canActivate(rpcContext(TcpHandlers, 'read', envelope({}, { userId: 'u-1' }))));

      expect(error['code']).toBe(GrpcStatus.PERMISSION_DENIED);
    });

    it('applies a class-level requirement to handlers without their own', () => {
      const payload = envelope({}, { userId: 'u-1', permissions: [] });

      expect(rpcError(() => guard.canActivate(rpcContext(ClassGated, 'inherits', payload)))['message']).toContain(
        'product:read',
      );
    });

    it('lets a handler-level requirement override the class-level one, not add to it', () => {
      const payload = envelope({}, { userId: 'u-1', permissions: ['product:write'] });

      expect(guard.canActivate(rpcContext(ClassGated, 'overrides', payload))).toBe(true);
    });
  });

  describe('@Public()', () => {
    it('skips identity and permission checks for a public TCP handler', () => {
      expect(guard.canActivate(rpcContext(TcpHandlers, 'publicHandler', { raw: true }))).toBe(true);
    });

    it('skips checks for a public gRPC handler, which never carries an RpcEnvelope', () => {
      expect(guard.canActivate(rpcContext(GrpcHandlers, 'publicGrpc', {}))).toBe(true);
    });

    // Regression for the gRPC-series bug: Nest reports getType() === 'rpc' for gRPC as well as
    // TCP, so this guard runs on every gRPC handler too. Opting out has to stay explicit per
    // handler — a gRPC handler without @Public() must not be silently exempted by transport.
    it('still rejects an un-enveloped call to a gRPC handler that did not opt out', () => {
      const error = rpcError(() => guard.canActivate(rpcContext(GrpcHandlers, 'guardedGrpc', {})));

      expect(error['code']).toBe(GrpcStatus.UNAUTHENTICATED);
    });
  });
});

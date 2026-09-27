import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { GrpcStatus } from '@libs/interceptors';
import { getRpcMeta } from '@libs/transports';
import { REQUIRED_PERMISSIONS_KEY } from './require-permission.decorator';

/**
 * Enforces authorization on the RPC surface (invoice/product/user-access's TCP message handlers)
 * using the permissions `bff`'s PermissionGuard already resolved and attached to the RpcEnvelope —
 * this guard never talks to Keycloak or a permission resolver itself, it just reads what's already
 * on the envelope. These RPC ports should only ever be called by `bff`, which always envelopes
 * with identity once a user is authenticated, so a call with no envelope at all is treated as
 * unauthenticated outright, independent of whether the specific handler declares a required
 * permission — the alternative (only checking identity on permission-gated handlers) would leave
 * every handler without `@RequirePermission` reachable by a raw, un-enveloped TCP message.
 *
 * Throws `RpcException` directly, pre-shaped the same way `RpcExceptionInterceptor` shapes a
 * thrown `HttpException` — guards run before interceptors in Nest's pipeline, so an exception
 * thrown here never reaches that interceptor's `catchError`. Without this, `bff`'s
 * `GrpcToHttpMapper` would see an error with no `status`/`code` and report a 502 instead of a
 * 401/403.
 */
@Injectable()
export class RpcPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'rpc') return true;

    const meta = getRpcMeta(context.switchToRpc().getData());

    if (!meta?.userId) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        status: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: 'This call requires an authenticated caller.',
      });
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const permissions = meta.permissions ?? [];
    const missing = required.filter((permission) => !permissions.includes(permission));

    if (missing.length > 0) {
      throw new RpcException({
        code: GrpcStatus.PERMISSION_DENIED,
        status: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        message: `Missing required permission(s): ${missing.join(', ')}.`,
      });
    }

    return true;
  }
}

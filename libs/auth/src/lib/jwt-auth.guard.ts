import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { setIdentityOnCurrentContext } from '@libs/logging';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedUser } from './authenticated-user.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  override handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser, info: { message?: string } | null) {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException(info?.message ?? 'Invalid or missing access token');
    }

    const authenticatedUser = user as AuthenticatedUser;
    // Mutates the request's existing AsyncLocalStorage store (set up by CorrelationIdMiddleware
    // earlier in the same request) so identity rides along on every outgoing RpcEnvelope, the
    // same way correlationId/traceId already do.
    setIdentityOnCurrentContext({ userId: authenticatedUser.sub, roles: authenticatedUser.roles });

    return user;
  }
}

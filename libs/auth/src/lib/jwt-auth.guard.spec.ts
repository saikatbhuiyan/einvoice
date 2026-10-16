import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { getCurrentCorrelationContext, runWithCorrelationContext } from '@libs/logging';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

@Controller()
class Routes {
  @Public()
  @Get('health')
  health() {
    return null;
  }
}

@Public()
@Controller()
class PublicController {
  @Get('anything')
  anything() {
    return null;
  }
}

function httpContext(cls: new () => object, method: string) {
  const handler = (cls.prototype as Record<string, () => unknown>)[method];
  const host = new ExecutionContextHost([{ headers: {} }, {}, () => undefined], cls, handler);
  host.setType('http');
  return host;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector());

  it('skips token verification for a @Public() handler', () => {
    expect(guard.canActivate(httpContext(Routes, 'health'))).toBe(true);
  });

  it('skips token verification for every handler on a @Public() controller', () => {
    expect(guard.canActivate(httpContext(PublicController, 'anything'))).toBe(true);
  });

  describe('handleRequest', () => {
    it('rejects a missing user with passport-jwt’s own reason as the message', () => {
      expect(() => guard.handleRequest(null, false, { message: 'jwt expired' })).toThrow(
        new UnauthorizedException('jwt expired'),
      );
    });

    it('rejects with a generic message when passport gives no reason', () => {
      expect(() => guard.handleRequest(null, false, null)).toThrow('Invalid or missing access token');
    });

    it('rethrows an error from the strategy as-is', () => {
      const failure = new Error('JWKS unreachable');

      expect(() => guard.handleRequest(failure, false, null)).toThrow(failure);
    });

    it('returns the user and stamps identity onto the correlation context for downstream RPC', () => {
      const user = { sub: 'u-1', username: 'dev.admin', roles: ['admin'] };

      const identity = runWithCorrelationContext({ correlationId: 'c', traceId: 't' }, () => {
        expect(guard.handleRequest(null, user, null)).toBe(user);
        const context = getCurrentCorrelationContext();
        return { userId: context?.userId, roles: context?.roles };
      });

      expect(identity).toEqual({ userId: 'u-1', roles: ['admin'] });
    });
  });
});

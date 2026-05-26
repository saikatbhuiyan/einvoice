import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitOptions, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';
import { RedisTokenBucketStorage } from './rate-limit.storage';
import { keyExtractors } from './rate-limit.key-extractor';
import { RateLimitConfiguration } from './rate-limit.config';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storage: RedisTokenBucketStorage,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const config = this.configService.get<RateLimitConfiguration>('RATE_LIMIT_CONFIG', { infer: true });

    const burst = options?.burst ?? config.RATE_LIMIT_BURST;
    const rate = options?.rate ?? config.RATE_LIMIT_RATE;
    const { name: extractorName, extract: keyExtractor } = this.resolveKeyExtractor(options?.keyExtractor);

    const request = context.switchToHttp().getRequest<Request>();
    const extractedKey = keyExtractor(request);
    const method = request.method;
    const route = request.route?.path ?? request.url;
    const key = `${config.RATE_LIMIT_KEY_PREFIX}:${extractorName}:${extractedKey}:${method}:${route}`;

    const result = await this.storage.consume(key, burst, rate, 1);

    const secondsUntilFull = (burst - result.remaining) / rate;
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('X-RateLimit-Limit', burst);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + secondsUntilFull));

    if (!result.allowed) {
      response.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Please retry after ${Math.ceil(result.retryAfterMs / 1000)} second(s).`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private resolveKeyExtractor(name?: 'ip' | 'apiKey'): { name: string; extract: (req: Request) => string } {
    switch (name) {
      case 'apiKey':
        return { name: 'apiKey', extract: keyExtractors.byApiKey };
      default:
        return { name: 'ip', extract: keyExtractors.byIp };
    }
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const RequestParam = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  if (ctx.getType() === 'http') {
    const request = ctx.switchToHttp().getRequest<Request>();
    return data ? request.params?.[data] : request.params;
  }

  if (ctx.getType() === 'rpc') {
    const payload = ctx.switchToRpc().getData();
    return data && payload && typeof payload === 'object' ? payload[data] : payload;
  }

  return null;
});

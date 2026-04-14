import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ProcessId = createParamDecorator((data: unknown, ctx: ExecutionContext) => process.pid);

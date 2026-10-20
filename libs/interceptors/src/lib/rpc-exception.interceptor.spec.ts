import { ConflictException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { RpcException } from '@nestjs/microservices';
import { lastValueFrom, throwError } from 'rxjs';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { GrpcStatus, RpcExceptionInterceptor } from './rpc-exception.interceptor';

describe('RpcExceptionInterceptor', () => {
  const rpcContext = () => {
    const host = new ExecutionContextHost([{}, {}]);
    host.setType('rpc');
    return host;
  };
  const errorFor = (thrown: unknown) =>
    lastValueFrom(
      new RpcExceptionInterceptor().intercept(rpcContext(), { handle: () => throwError(() => thrown) }),
    ).catch((error: RpcException) => error.getError());

  it("keeps an HttpException's status for the caller", async () => {
    await expect(errorFor(new ConflictException('nope'))).resolves.toMatchObject({
      status: 409,
      code: GrpcStatus.ALREADY_EXISTS,
    });
  });

  // e.g. a peer calling a @Public() tenant handler without an organization in its envelope.
  it("reports a call with no organization as the caller's error (400), not an internal one", async () => {
    await expect(errorFor(new MissingOrganizationContextError())).resolves.toEqual({
      code: GrpcStatus.INVALID_ARGUMENT,
      status: 400,
      error: 'Bad Request',
      message: 'This call carries no organization.',
    });
  });

  it('reports any other error as internal', async () => {
    await expect(errorFor(new Error('boom'))).resolves.toMatchObject({ code: GrpcStatus.INTERNAL });
  });
});

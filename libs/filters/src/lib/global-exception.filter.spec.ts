import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { runWithCorrelationContext } from '@libs/logging';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  const OTEL_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

  function setup(responseHeaders: Record<string, string> = {}) {
    const reply = jest.fn();
    const filter = new GlobalExceptionFilter({
      httpAdapter: { reply, setHeader: jest.fn() },
    } as unknown as HttpAdapterHost);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/api/v1/invoices/x', method: 'GET', headers: { 'x-correlation-id': 'corr-1' } }),
        getResponse: () => ({ getHeader: (name: string) => responseHeaders[name] }),
      }),
    } as unknown as ArgumentsHost;
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    return { filter, host, reply };
  }

  it('reports the x-trace-id header as traceId, separately from the correlation id', () => {
    const { filter, host, reply } = setup({ 'x-trace-id': OTEL_TRACE_ID });

    filter.catch(new NotFoundException('Invoice not found'), host);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 404, traceId: OTEL_TRACE_ID, correlationId: 'corr-1' }),
      404,
    );
  });

  it('applies the same ids to validation problems and unhandled errors', () => {
    const { filter, host, reply } = setup({ 'x-trace-id': OTEL_TRACE_ID });

    filter.catch(new HttpException({ message: ['email must be an email'] }, 422), host);
    filter.catch(new Error('boom'), host);

    for (const [, body] of reply.mock.calls) {
      expect(body).toMatchObject({ traceId: OTEL_TRACE_ID, correlationId: 'corr-1' });
    }
  });

  it('falls back to the correlation context, then the correlation id, without the header', () => {
    const { filter, host, reply } = setup();

    runWithCorrelationContext({ correlationId: 'corr-1', traceId: 'ctx-trace' }, () =>
      filter.catch(new NotFoundException(), host),
    );
    filter.catch(new NotFoundException(), host);

    expect(reply.mock.calls[0][1]).toMatchObject({ traceId: 'ctx-trace' });
    expect(reply.mock.calls[1][1]).toMatchObject({ traceId: 'corr-1' });
  });
});

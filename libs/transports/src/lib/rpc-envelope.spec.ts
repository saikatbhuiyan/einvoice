import { runWithCorrelationContext } from '@libs/logging';
import { createRpcEnvelope, isRpcEnvelope, unwrapRpcPayload } from './rpc-envelope';

describe('RPC envelope', () => {
  it('wraps payloads with current correlation metadata', () => {
    const envelope = runWithCorrelationContext({ correlationId: 'corr-1', traceId: 'trace-1' }, () =>
      createRpcEnvelope({ id: 'invoice-1' }, 'bff'),
    );

    expect(envelope).toEqual({
      data: { id: 'invoice-1' },
      meta: expect.objectContaining({
        correlationId: 'corr-1',
        traceId: 'trace-1',
        sourceService: 'bff',
      }),
    });
  });

  it('unwraps envelope payloads', () => {
    const envelope = createRpcEnvelope({ id: 'invoice-1' }, 'bff');

    expect(isRpcEnvelope(envelope)).toBe(true);
    expect(unwrapRpcPayload(envelope)).toEqual({ id: 'invoice-1' });
  });

  it('accepts legacy raw payloads', () => {
    const payload = { id: 'invoice-1' };

    expect(isRpcEnvelope(payload)).toBe(false);
    expect(unwrapRpcPayload(payload)).toBe(payload);
  });
});

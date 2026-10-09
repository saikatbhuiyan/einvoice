import { describeRpcError } from './base-tcp.client';

describe('describeRpcError', () => {
  it("serializes the callee's plain RPC error object instead of logging [object Object]", () => {
    expect(describeRpcError({ status: 404, message: 'Invoice not found', error: 'Not Found' })).toBe(
      '{"status":404,"message":"Invoice not found","error":"Not Found"}',
    );
  });

  it('uses the message of a real Error and stringifies primitives', () => {
    expect(describeRpcError(new Error('connect ECONNREFUSED'))).toBe('connect ECONNREFUSED');
    expect(describeRpcError('boom')).toBe('boom');
  });

  it('survives an object that cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(describeRpcError(circular)).toBe('[object Object]');
  });
});

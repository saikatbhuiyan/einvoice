import { ArgumentsHost, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckExceptionFilter } from './health-check-exception.filter';

describe('HealthCheckExceptionFilter', () => {
  function createHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it("responds with terminus's body unchanged so the failing check stays visible", () => {
    const body = {
      status: 'error',
      info: { memory_heap: { status: 'up' } },
      error: { redis: { status: 'down', message: 'Redis connection status is "reconnecting"' } },
      details: {
        memory_heap: { status: 'up' },
        redis: { status: 'down', message: 'Redis connection status is "reconnecting"' },
      },
    };
    const { host, status, json } = createHost();

    new HealthCheckExceptionFilter().catch(new ServiceUnavailableException(body), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(body);
  });
});

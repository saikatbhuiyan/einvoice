import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';
import { CircuitState } from './circuit-breaker.state';
import type { CircuitBreakerConfiguration } from './circuit-breaker.config';

describe('CircuitBreaker', () => {
  let config: CircuitBreakerConfiguration;
  let logger: Logger;
  let now: number;
  let clock: jest.Mock<number, []>;

  beforeEach(() => {
    config = {
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
      CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
      CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES: 3,
      CIRCUIT_BREAKER_LOG_LEVEL: 'warn',
    } as CircuitBreakerConfiguration;

    logger = new Logger('TestCircuitBreaker');
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);

    now = 1000;
    clock = jest.fn(() => now);
  });

  function createBreaker(): CircuitBreaker {
    return new CircuitBreaker(config, logger, 'INVOICE', clock);
  }

  describe('CLOSED state', () => {
    it('should allow calls when circuit is closed', async () => {
      const breaker = createBreaker();
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('should not open circuit on client errors (4xx)', async () => {
      const breaker = createBreaker();
      const clientErrors = [
        new NotFoundException(),
        new BadRequestException(),
        new UnauthorizedException(),
        new ForbiddenException(),
        new ConflictException(),
      ];

      for (const error of clientErrors) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow(error);
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
      expect(breaker.getMetrics().failureCount).toBe(0);
    });

    it('should not open circuit on RPC client errors, which arrive as a plain HttpException', async () => {
      const breaker = createBreaker();
      // What BaseTcpClient.toHttpException actually produces for a downstream 404 / 422.
      const rpcClientErrors = [
        new HttpException({ statusCode: 404, message: 'Invoice not found', error: 'Not Found' }, 404),
        new HttpException({ statusCode: 422, message: ['invalid'], error: 'Unprocessable Entity' }, 422),
      ];

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2; i++) {
        const error = rpcClientErrors[i % rpcClientErrors.length];
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow(error);
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
      expect(breaker.getMetrics().failureCount).toBe(0);
    });

    it('should count 5xx HttpExceptions, 429, and non-HTTP errors as failures', async () => {
      const breaker = createBreaker();

      await expect(breaker.execute(() => Promise.reject(new HttpException('bad gateway', 502)))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new HttpException('slow down', 429)))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('ECONNREFUSED')))).rejects.toThrow();

      expect(breaker.getMetrics().failureCount).toBe(3);
    });

    it('should only open on consecutive failures: a success resets the count', async () => {
      const breaker = createBreaker();
      const fail = () => Promise.reject(new ServiceUnavailableException('down'));

      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i++) {
          await expect(breaker.execute(fail)).rejects.toThrow(ServiceUnavailableException);
        }
        await breaker.execute(() => Promise.resolve('ok'));
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
      expect(breaker.getMetrics().failureCount).toBe(0);
      expect(breaker.getMetrics().totalErrors).toBe(3 * (config.CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1));
    });

    it('should open circuit after reaching failure threshold', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new ServiceUnavailableException('down')))).rejects.toThrow(
          ServiceUnavailableException,
        );
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
      expect(breaker.getMetrics().failureCount).toBe(5);
    });

    it('should track success count', async () => {
      const breaker = createBreaker();

      await breaker.execute(() => Promise.resolve('ok'));
      await breaker.execute(() => Promise.resolve('ok'));

      expect(breaker.getMetrics().successCount).toBe(2);
    });

    it('should count GatewayTimeoutException as both timeout and error', async () => {
      const breaker = createBreaker();

      await expect(breaker.execute(() => Promise.reject(new GatewayTimeoutException('timeout')))).rejects.toThrow(
        GatewayTimeoutException,
      );

      expect(breaker.getMetrics().totalTimeouts).toBe(1);
      expect(breaker.getMetrics().totalErrors).toBe(1);
      expect(breaker.getMetrics().failureCount).toBe(1);
    });
  });

  describe('OPEN state', () => {
    it('should reject immediately when circuit is open', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      await expect(breaker.execute(() => Promise.resolve('should not reach'))).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(breaker.getMetrics().totalRejected).toBe(1);
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

      now += config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1;

      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('HALF_OPEN state', () => {
    it('should close circuit after enough successful probes', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      now += config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1;

      for (let i = 0; i < config.CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }

      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
      expect(breaker.getMetrics().failureCount).toBe(0);
    });

    it('should reopen circuit on probe failure', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      now += config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1;

      await breaker.execute(() => Promise.resolve('probe 1'));
      await breaker.execute(() => Promise.resolve('probe 2'));

      await expect(breaker.execute(() => Promise.reject(new Error('probe fail')))).rejects.toThrow(Error);

      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
    });

    it('should reject excess requests beyond probe limit', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      now += config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1;

      // The limit caps probes *in flight* while half-open. Run sequentially, the probes would all
      // succeed and close the circuit before the next call, so hold them open until the excess
      // call has been made.
      let releaseProbes!: () => void;
      const probesReleased = new Promise<void>((resolve) => (releaseProbes = resolve));
      const probes = Array.from({ length: config.CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES }, () =>
        breaker.execute(() => probesReleased.then(() => 'probe')),
      );

      await expect(breaker.execute(() => Promise.resolve('excess'))).rejects.toThrow(ServiceUnavailableException);
      expect(breaker.getMetrics().totalRejected).toBe(1);

      releaseProbes();
      await expect(Promise.all(probes)).resolves.toEqual(['probe', 'probe', 'probe']);
      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    });

    it('should not count client errors as probe failure in HALF_OPEN', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow(Error);
      }

      now += config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1;

      await expect(breaker.execute(() => Promise.reject(new NotFoundException()))).rejects.toThrow(NotFoundException);

      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('metrics', () => {
    it('should track totalRejected, totalTimeouts, totalErrors', async () => {
      const breaker = createBreaker();

      for (let i = 0; i < config.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await expect(breaker.execute(() => Promise.reject(new GatewayTimeoutException('timeout')))).rejects.toThrow(
          GatewayTimeoutException,
        );
      }

      expect(breaker.getMetrics().totalErrors).toBe(5);
      expect(breaker.getMetrics().totalTimeouts).toBe(5);
      expect(breaker.getMetrics().failureCount).toBe(5);

      await expect(breaker.execute(() => Promise.resolve('no'))).rejects.toThrow(ServiceUnavailableException);
      expect(breaker.getMetrics().totalRejected).toBe(1);
    });
  });
});

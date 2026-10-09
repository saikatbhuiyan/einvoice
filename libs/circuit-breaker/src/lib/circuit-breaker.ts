import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CircuitState } from './circuit-breaker.state';
import type { CircuitBreakerMetrics } from './circuit-breaker.state';
import type { CircuitBreakerConfiguration } from './circuit-breaker.config';

@Injectable()
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private stateChangedAt = 0;
  private totalRejected = 0;
  private totalTimeouts = 0;
  private totalErrors = 0;
  private halfOpenAdmissionCount = 0;
  private halfOpenSuccessCount = 0;

  constructor(
    private readonly config: CircuitBreakerConfiguration,
    private readonly logger: Logger,
    private readonly serviceName: string,
    private readonly now: () => number = Date.now,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.now() >= this.stateChangedAt + this.config.CIRCUIT_BREAKER_RESET_TIMEOUT_MS) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        this.totalRejected++;
        throw new ServiceUnavailableException(`Circuit breaker for "${this.serviceName}" is open. Failing fast.`);
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAdmissionCount >= this.config.CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES) {
        this.totalRejected++;
        throw new ServiceUnavailableException(
          `Circuit breaker for "${this.serviceName}" is half-open. Probe limit reached.`,
        );
      }
      this.halfOpenAdmissionCount++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateChangedAt: this.stateChangedAt,
      totalRejected: this.totalRejected,
      totalTimeouts: this.totalTimeouts,
      totalErrors: this.totalErrors,
    };
  }

  /**
   * Only failures that say the callee is unhealthy count: 5xx, timeouts, connection errors, and
   * 429 (the callee explicitly asking for less load). Any other 4xx means the callee answered
   * fine and the *request* was the problem -- counting those would let a client probing missing
   * ids open the breaker and take the whole service offline for everyone.
   *
   * Classified by status, not exception class: BaseTcpClient maps a downstream 404 to a plain
   * `new HttpException(body, 404)`, never a NotFoundException, so the instanceof checks this
   * replaced never matched a real RPC client error at all.
   */
  private isCircuitBreakingError(error: unknown): boolean {
    if (!(error instanceof HttpException)) return true;
    const status = error.getStatus();
    return status >= 500 || status === HttpStatus.TOO_MANY_REQUESTS;
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === CircuitState.CLOSED) {
      // The threshold is for *consecutive* failures. Without this reset, failures spread over
      // hours of otherwise healthy traffic accumulated until the breaker eventually tripped.
      this.failureCount = 0;
      return;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.config.CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES) {
        const logFn =
          this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'error'
            ? this.logger.error
            : this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'log'
              ? this.logger.log
              : this.logger.warn;
        logFn.call(
          this.logger,
          `Circuit breaker for "${this.serviceName}" HALF_OPEN → CLOSED (${this.halfOpenSuccessCount} successful probes)`,
        );
        this.failureCount = 0;
        this.halfOpenAdmissionCount = 0;
        this.halfOpenSuccessCount = 0;
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  private onFailure(error: unknown): void {
    if (!this.isCircuitBreakingError(error)) {
      return;
    }

    this.failureCount++;
    this.lastFailureTime = this.now();
    this.totalErrors++;

    if (error instanceof GatewayTimeoutException) {
      this.totalTimeouts++;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      const logFn =
        this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'error'
          ? this.logger.error
          : this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'log'
            ? this.logger.log
            : this.logger.warn;
      logFn.call(
        this.logger,
        `Circuit breaker for "${this.serviceName}" HALF_OPEN → OPEN (probe failed: ${this.errorMessage(error)})`,
      );
      this.halfOpenAdmissionCount = 0;
      this.halfOpenSuccessCount = 0;
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    if (this.failureCount >= this.config.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      const logFn =
        this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'error'
          ? this.logger.error
          : this.config.CIRCUIT_BREAKER_LOG_LEVEL === 'log'
            ? this.logger.log
            : this.logger.warn;
      logFn.call(
        this.logger,
        `Circuit breaker for "${this.serviceName}" CLOSED → OPEN (${this.failureCount} consecutive failures)`,
      );
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.stateChangedAt = this.now();
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

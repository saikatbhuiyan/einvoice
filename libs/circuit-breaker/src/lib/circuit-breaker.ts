import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  NotFoundException,
  UnauthorizedException,
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

  private isCircuitBreakingError(error: unknown): boolean {
    if (error instanceof NotFoundException) return false;
    if (error instanceof BadRequestException) return false;
    if (error instanceof UnauthorizedException) return false;
    if (error instanceof ForbiddenException) return false;
    if (error instanceof ConflictException) return false;
    return true;
  }

  private onSuccess(): void {
    this.successCount++;

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

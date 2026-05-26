import { Injectable, Logger } from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';
import type { CircuitBreakerConfiguration } from './circuit-breaker.config';

@Injectable()
export class CircuitBreakerFactory {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly config: CircuitBreakerConfiguration) {}

  get(serviceName: string): CircuitBreaker {
    let breaker = this.breakers.get(serviceName);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config, new Logger(`CircuitBreaker:${serviceName}`), serviceName);
      this.breakers.set(serviceName, breaker);
    }
    return breaker;
  }
}

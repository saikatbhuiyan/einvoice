import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CircuitBreakerConfiguration {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES = 3;

  @IsString()
  @IsNotEmpty()
  CIRCUIT_BREAKER_LOG_LEVEL: 'log' | 'warn' | 'error' = 'warn';

  constructor() {
    this.CIRCUIT_BREAKER_FAILURE_THRESHOLD = Number(process.env['CIRCUIT_BREAKER_FAILURE_THRESHOLD'] ?? 5);
    this.CIRCUIT_BREAKER_RESET_TIMEOUT_MS = Number(process.env['CIRCUIT_BREAKER_RESET_TIMEOUT_MS'] ?? 30_000);
    this.CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES = Number(process.env['CIRCUIT_BREAKER_HALF_OPEN_MAX_PROBES'] ?? 3);
    this.CIRCUIT_BREAKER_LOG_LEVEL = (process.env['CIRCUIT_BREAKER_LOG_LEVEL'] as 'log' | 'warn' | 'error') ?? 'warn';
  }
}

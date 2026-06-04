import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerConfiguration } from './circuit-breaker.config';
import { CircuitBreakerFactory } from './circuit-breaker.factory';

export const CIRCUIT_BREAKER_FACTORY = Symbol('CIRCUIT_BREAKER_FACTORY');

@Global()
@Module({})
export class CircuitBreakerModule {
  static forRoot(): DynamicModule {
    return {
      module: CircuitBreakerModule,
      providers: [
        {
          provide: CIRCUIT_BREAKER_FACTORY,
          useFactory: (configService: ConfigService) => {
            const config = configService.get<CircuitBreakerConfiguration>('CIRCUIT_BREAKER_CONFIG', { infer: true });
            return new CircuitBreakerFactory(config);
          },
          inject: [ConfigService],
        },
      ],
      exports: [CIRCUIT_BREAKER_FACTORY],
    };
  }
}

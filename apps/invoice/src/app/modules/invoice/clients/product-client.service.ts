import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import type { ProductResponse } from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

/** invoice -> product: the products catalog-backed lines refer to, in the caller's organization. */
@Injectable()
export class ProductClientService extends BaseTcpClient {
  protected readonly logger = new Logger(ProductClientService.name);
  protected readonly serviceName = ServiceName.PRODUCT;
  protected override readonly sourceService = 'invoice';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.PRODUCT])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  /** Only the ones that exist in the organization come back; a missing id simply isn't there. */
  async findMany(ids: string[]): Promise<ProductResponse[]> {
    return this.send<ProductResponse[], { ids: string[] }>(TCP_PATTERNS.PRODUCT.FIND_MANY, { ids });
  }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import {
  CreateProductRequest,
  FindAllProductsRequest,
  FindAllProductsResponse,
  ProductResponse,
} from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

@Injectable()
export class ProductClientService extends BaseTcpClient {
  protected readonly logger = new Logger(ProductClientService.name);
  protected readonly serviceName = ServiceName.PRODUCT;
  protected override readonly sourceService = 'bff';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.PRODUCT])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async createProduct(data: CreateProductRequest): Promise<ProductResponse> {
    return this.send<ProductResponse, CreateProductRequest>(TCP_PATTERNS.PRODUCT.CREATE, data);
  }

  async findAllProducts(query: FindAllProductsRequest): Promise<FindAllProductsResponse> {
    return this.send<FindAllProductsResponse, FindAllProductsRequest>(TCP_PATTERNS.PRODUCT.FIND_ALL, query);
  }
}

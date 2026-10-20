import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import type {
  CreateCustomerRequest,
  CustomerIdGatewayRequest,
  CustomerResponse,
  DeleteCustomerResponse,
  FindAllCustomersRequest,
  FindAllCustomersResponse,
  UpdateCustomerGatewayRequest,
  UpdateCustomerRequest,
} from '@libs/interfaces/gateway';
import { BaseTcpClient, ServiceName, TCP_CLIENT_TOKENS, TCP_PATTERNS } from '@libs/transports';

/** Customers live in the invoice service (they exist to be invoiced). */
@Injectable()
export class CustomerClientService extends BaseTcpClient {
  protected readonly logger = new Logger(CustomerClientService.name);
  protected readonly serviceName = ServiceName.INVOICE;
  protected override readonly sourceService = 'bff';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.INVOICE])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  createCustomer(data: CreateCustomerRequest): Promise<CustomerResponse> {
    return this.send<CustomerResponse, CreateCustomerRequest>(TCP_PATTERNS.CUSTOMER.CREATE, data);
  }

  findAllCustomers(query: FindAllCustomersRequest): Promise<FindAllCustomersResponse> {
    return this.send<FindAllCustomersResponse, FindAllCustomersRequest>(TCP_PATTERNS.CUSTOMER.FIND_ALL, query);
  }

  findOneCustomer(id: string): Promise<CustomerResponse> {
    return this.send<CustomerResponse, CustomerIdGatewayRequest>(TCP_PATTERNS.CUSTOMER.FIND_ONE, { id });
  }

  updateCustomer(id: string, data: UpdateCustomerRequest): Promise<CustomerResponse> {
    return this.send<CustomerResponse, UpdateCustomerGatewayRequest>(TCP_PATTERNS.CUSTOMER.UPDATE, { id, data });
  }

  removeCustomer(id: string): Promise<DeleteCustomerResponse> {
    return this.send<DeleteCustomerResponse, CustomerIdGatewayRequest>(TCP_PATTERNS.CUSTOMER.DELETE, { id });
  }
}

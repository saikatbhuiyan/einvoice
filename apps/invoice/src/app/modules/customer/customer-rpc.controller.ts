import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import type {
  CreateCustomerRequest,
  CustomerIdGatewayRequest,
  FindAllCustomersRequest,
  UpdateCustomerGatewayRequest,
} from '@libs/interfaces/gateway';
import { CustomerService } from './customer.service';

@Controller()
export class CustomerRpcController {
  constructor(private readonly customerService: CustomerService) {}

  @MessagePattern(TCP_PATTERNS.CUSTOMER.CREATE)
  @RequirePermission('customer:write')
  create(@Payload() payload: RpcEnvelope<CreateCustomerRequest> | CreateCustomerRequest) {
    return this.customerService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.CUSTOMER.FIND_ALL)
  @RequirePermission('customer:read')
  findAll(@Payload() payload: RpcEnvelope<FindAllCustomersRequest> | FindAllCustomersRequest) {
    return this.customerService.findAll(unwrapRpcPayload(payload) ?? {});
  }

  @MessagePattern(TCP_PATTERNS.CUSTOMER.FIND_ONE)
  @RequirePermission('customer:read')
  findOne(@Payload() payload: RpcEnvelope<CustomerIdGatewayRequest> | CustomerIdGatewayRequest) {
    return this.customerService.findOne(unwrapRpcPayload(payload).id);
  }

  @MessagePattern(TCP_PATTERNS.CUSTOMER.UPDATE)
  @RequirePermission('customer:write')
  update(@Payload() payload: RpcEnvelope<UpdateCustomerGatewayRequest> | UpdateCustomerGatewayRequest) {
    const { id, data } = unwrapRpcPayload(payload);
    return this.customerService.update(id, data);
  }

  @MessagePattern(TCP_PATTERNS.CUSTOMER.DELETE)
  @RequirePermission('customer:write')
  remove(@Payload() payload: RpcEnvelope<CustomerIdGatewayRequest> | CustomerIdGatewayRequest) {
    return this.customerService.remove(unwrapRpcPayload(payload).id);
  }
}

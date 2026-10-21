import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import {
  CreateProductDto,
  FindAllProductsDto,
  FindManyProductsDto,
  ProductIdGatewayDto,
  UpdateProductGatewayDto,
} from '@libs/interfaces/gateway';
import { ProductService } from './product.service';

@Controller()
export class ProductRpcController {
  constructor(private readonly productService: ProductService) {}

  @MessagePattern(TCP_PATTERNS.PRODUCT.CREATE)
  @RequirePermission('product:write')
  createByMessage(@Payload() payload: RpcEnvelope<CreateProductDto> | CreateProductDto) {
    return this.productService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.PRODUCT.FIND_ALL)
  @RequirePermission('product:read')
  findAllByMessage(
    @Payload() payload: RpcEnvelope<FindAllProductsDto> | FindAllProductsDto = new FindAllProductsDto(),
  ) {
    return this.productService.findAll(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.PRODUCT.FIND_ONE)
  @RequirePermission('product:read')
  findOneByMessage(@Payload() payload: RpcEnvelope<ProductIdGatewayDto> | ProductIdGatewayDto) {
    return this.productService.findOne(unwrapRpcPayload(payload).id);
  }

  /** Called by invoice for the user creating or editing an invoice (every role with invoice:write has product:read). */
  @MessagePattern(TCP_PATTERNS.PRODUCT.FIND_MANY)
  @RequirePermission('product:read')
  findManyByMessage(@Payload() payload: RpcEnvelope<FindManyProductsDto> | FindManyProductsDto) {
    return this.productService.findMany(unwrapRpcPayload(payload)?.ids);
  }

  @MessagePattern(TCP_PATTERNS.PRODUCT.UPDATE)
  @RequirePermission('product:write')
  updateByMessage(@Payload() payload: RpcEnvelope<UpdateProductGatewayDto> | UpdateProductGatewayDto) {
    const { id, data } = unwrapRpcPayload(payload);
    return this.productService.update(id, data);
  }

  @MessagePattern(TCP_PATTERNS.PRODUCT.DEACTIVATE)
  @RequirePermission('product:write')
  deactivateByMessage(@Payload() payload: RpcEnvelope<ProductIdGatewayDto> | ProductIdGatewayDto) {
    return this.productService.deactivate(unwrapRpcPayload(payload).id);
  }
}

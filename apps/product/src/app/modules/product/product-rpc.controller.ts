import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { CreateProductDto, FindAllProductsDto } from '@libs/interfaces/gateway';
import { ProductService } from './product.service';

@Controller()
export class ProductRpcController {
  constructor(private readonly productService: ProductService) {}

  @MessagePattern(TCP_PATTERNS.PRODUCT.CREATE)
  createByMessage(@Payload() payload: RpcEnvelope<CreateProductDto> | CreateProductDto) {
    return this.productService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.PRODUCT.FIND_ALL)
  findAllByMessage(
    @Payload() payload: RpcEnvelope<FindAllProductsDto> | FindAllProductsDto = new FindAllProductsDto(),
  ) {
    return this.productService.findAll(unwrapRpcPayload(payload));
  }
}

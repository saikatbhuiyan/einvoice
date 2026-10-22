import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { INVOICE_CONSTRAINTS } from '@libs/shared/types';
import type { FindManyProductsRequest, ProductIdGatewayRequest, UpdateProductGatewayRequest } from './product.types';
import { UpdateProductDto } from './update-product.dto';

export class ProductIdGatewayDto implements ProductIdGatewayRequest {
  @ApiProperty({ example: '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10', description: 'Product identifier (UUID).' })
  @IsUUID()
  id!: string;
}

export class UpdateProductGatewayDto extends ProductIdGatewayDto implements UpdateProductGatewayRequest {
  @ApiProperty({ type: () => UpdateProductDto, description: 'Product fields to update.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateProductDto)
  data!: UpdateProductDto;
}

export class FindManyProductsDto implements FindManyProductsRequest {
  @IsArray()
  @ArrayMaxSize(INVOICE_CONSTRAINTS.items.maxItems)
  @IsUUID('all', { each: true })
  ids!: string[];
}

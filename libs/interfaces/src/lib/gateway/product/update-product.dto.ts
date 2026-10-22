import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
import type { UpdateProductRequest } from './product.types';

/** Every field optional, each validated as on create. `isActive: true` reactivates a product. */
export class UpdateProductDto extends PartialType(CreateProductDto) implements UpdateProductRequest {}

import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreateProductDto, FindAllProductsDto } from '@libs/interfaces/gateway';
import { ProductService } from './product.service';

@Controller('products')
export class ProductHttpController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productService.create(createProductDto);
  }

  @Get()
  findAll(@Query() query: FindAllProductsDto) {
    return this.productService.findAll(query);
  }
}

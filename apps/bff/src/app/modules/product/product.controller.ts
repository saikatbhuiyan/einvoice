import { Body, Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiExtraModels, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateProductDto,
  FindAllProductsDto,
  FindAllProductsResponseDto,
  ProductResponseDto,
} from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import {
  RATE_LIMIT_DEFAULT_BURST,
  RATE_LIMIT_DEFAULT_RATE,
  RATE_LIMIT_MUTATE_BURST,
  RATE_LIMIT_MUTATE_RATE,
} from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import {
  CREATE_PRODUCT_EXAMPLE,
  FIND_ALL_PRODUCTS_RESPONSE_EXAMPLE,
  PRODUCT_RESPONSE_EXAMPLE,
} from './product.examples';
import { ProductService } from './product.service';

@ApiTags('Products')
@ApiCorrelationIdHeader()
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Product created successfully')
  @ApiOperation({
    summary: 'Create product',
    description: 'Creates a catalog product through the product service.',
  })
  @ApiBody({
    type: CreateProductDto,
    examples: {
      product: {
        summary: 'Subscription product',
        value: CREATE_PRODUCT_EXAMPLE,
      },
    },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'Product created.',
    model: ProductResponseDto,
    message: 'Product created successfully',
    dataExample: PRODUCT_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  create(@Body() payload: CreateProductDto) {
    return this.productService.create(payload);
  }

  @Get()
  @ResponseMessage('Products retrieved successfully')
  @ApiOperation({
    summary: 'List products',
    description: 'Returns products with offset pagination, optional free-text search, and an isActive filter.',
  })
  @ApiExtraModels(FindAllProductsResponseDto)
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Products retrieved.',
    model: ProductResponseDto,
    message: 'Products retrieved successfully',
    dataExample: FIND_ALL_PRODUCTS_RESPONSE_EXAMPLE,
    isArray: true,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  findAll(@Query() query: FindAllProductsDto, @Res({ passthrough: true }) res: Response) {
    return this.productService.findAll(query, res);
  }
}

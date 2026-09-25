import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../../../database/entities/product.entity';
import { ProductHttpController } from './product-http.controller';
import { ProductRpcController } from './product-rpc.controller';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';
import { PRODUCT_REPOSITORY } from './product.repository.interface';

@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity])],
  controllers: [ProductHttpController, ProductRpcController],
  providers: [
    ProductService,
    {
      provide: PRODUCT_REPOSITORY,
      useClass: ProductRepository,
    },
  ],
})
export class ProductModule {}

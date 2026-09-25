import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { createTcpClientConfig, ServiceName } from '@libs/transports';
import { CacheModule } from '@libs/cache';
import { ProductClientService } from './product-client.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

@Module({
  imports: [ClientsModule.register([createTcpClientConfig(ServiceName.PRODUCT)]), CacheModule.forRoot('bff')],
  controllers: [ProductController],
  providers: [ProductClientService, ProductService],
})
export class ProductModule {}

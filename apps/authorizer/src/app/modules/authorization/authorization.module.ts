import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { CacheModule } from '@libs/cache';
import { createGrpcClientConfig, GrpcServiceName } from '@libs/transports';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';

@Module({
  imports: [
    ClientsModule.register([createGrpcClientConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY)]),
    CacheModule.forRoot('authorizer'),
  ],
  controllers: [AuthorizationController],
  providers: [AuthorizationService],
})
export class AuthorizationModule {}

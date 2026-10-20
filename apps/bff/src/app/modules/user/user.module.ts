import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { createTcpClientConfig, ServiceName } from '@libs/transports';
import { CacheModule } from '@libs/cache';
import { UserClientService } from './user-client.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { OrganizationController } from './organization.controller';

@Module({
  imports: [ClientsModule.register([createTcpClientConfig(ServiceName.USER)]), CacheModule.forRoot('bff')],
  controllers: [UserController, OrganizationController],
  providers: [UserClientService, UserService],
  exports: [UserService],
})
export class UserModule {}

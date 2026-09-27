import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { UserEntity } from '../../../database/entities/user.entity';
import { RoleModule } from '../role/role.module';
import { UserHttpController } from './user-http.controller';
import { UserRpcController } from './user-rpc.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { USER_REPOSITORY } from './user.repository.interface';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), RoleModule, HttpModule],
  controllers: [UserHttpController, UserRpcController],
  providers: [
    UserService,
    KeycloakAdminService,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    },
  ],
})
export class UserModule {}

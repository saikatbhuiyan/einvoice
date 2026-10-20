import { Module } from '@nestjs/common';
import { RoleModule } from '../role/role.module';
import { MembershipModule } from '../membership/membership.module';
import { UserHttpController } from './user-http.controller';
import { UserRpcController } from './user-rpc.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { USER_REPOSITORY } from './user.repository.interface';

@Module({
  imports: [RoleModule, MembershipModule],
  controllers: [UserHttpController, UserRpcController],
  providers: [UserService, { provide: USER_REPOSITORY, useClass: UserRepository }],
})
export class UserModule {}

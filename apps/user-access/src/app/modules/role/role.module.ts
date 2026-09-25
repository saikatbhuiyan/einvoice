import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from '../../../database/entities/role.entity';
import { RoleHttpController } from './role-http.controller';
import { RoleRpcController } from './role-rpc.controller';
import { RoleService } from './role.service';
import { RoleRepository } from './role.repository';
import { ROLE_REPOSITORY } from './role.repository.interface';

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity])],
  controllers: [RoleHttpController, RoleRpcController],
  providers: [
    RoleService,
    {
      provide: ROLE_REPOSITORY,
      useClass: RoleRepository,
    },
  ],
  exports: [RoleService],
})
export class RoleModule {}

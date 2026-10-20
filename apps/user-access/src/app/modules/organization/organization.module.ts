import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../../../database/entities/organization.entity';
import { RoleModule } from '../role/role.module';
import { MembershipModule } from '../membership/membership.module';
import { OrganizationRpcController } from './organization-rpc.controller';
import { OrganizationService } from './organization.service';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationEntity]), RoleModule, MembershipModule],
  controllers: [OrganizationRpcController],
  providers: [OrganizationService],
})
export class OrganizationModule {}

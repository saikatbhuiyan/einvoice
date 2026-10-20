import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { RoleModule } from '../role/role.module';
import { MemberProvisioningService } from './member-provisioning.service';
import { MembershipDirectory } from './membership-directory';
import { MembershipGrpcController } from './membership-grpc.controller';

@Module({
  imports: [RoleModule, HttpModule],
  controllers: [MembershipGrpcController],
  providers: [MembershipDirectory, MemberProvisioningService, KeycloakAdminService],
  exports: [MembershipDirectory, MemberProvisioningService, KeycloakAdminService],
})
export class MembershipModule {}

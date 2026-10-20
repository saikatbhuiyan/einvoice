import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { Public } from '@libs/auth/public.decorator';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import type {
  CreateOrganizationRequest,
  FindAllOrganizationsRequest,
  OrganizationIdGatewayRequest,
  UpdateCurrentOrganizationRequest,
} from '@libs/interfaces/gateway';
import { OrganizationService } from './organization.service';

/** platform:admin is a platform permission, so these need no active organization. */
@Controller()
export class OrganizationRpcController {
  constructor(private readonly organizationService: OrganizationService) {}

  @MessagePattern(TCP_PATTERNS.ORGANIZATION.CREATE)
  @RequirePermission('platform:admin')
  create(@Payload() payload: RpcEnvelope<CreateOrganizationRequest> | CreateOrganizationRequest) {
    return this.organizationService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.ORGANIZATION.FIND_ALL)
  @RequirePermission('platform:admin')
  findAll(@Payload() payload: RpcEnvelope<FindAllOrganizationsRequest> | FindAllOrganizationsRequest) {
    return this.organizationService.findAll(unwrapRpcPayload(payload) ?? {});
  }

  // The caller's active organization, from the context -- never an id from the payload, so neither
  // handler can be pointed at another tenant.
  @MessagePattern(TCP_PATTERNS.ORGANIZATION.FIND_CURRENT)
  @RequirePermission('organization:read')
  findCurrent() {
    return this.organizationService.findOne(requireOrganizationId());
  }

  @MessagePattern(TCP_PATTERNS.ORGANIZATION.UPDATE_CURRENT)
  @RequirePermission('organization:write')
  updateCurrent(@Payload() payload: RpcEnvelope<UpdateCurrentOrganizationRequest> | UpdateCurrentOrganizationRequest) {
    return this.organizationService.updateSettings(requireOrganizationId(), unwrapRpcPayload(payload) ?? {});
  }

  // invoice numbering an invoice: with an end user behind it or not (its internal API, scheduled
  // issuing), so @Public() like ROLE.FIND_ALL and INVOICE.MARK_PAID. The organization comes from the
  // envelope, never the payload, and only the prefix is returned.
  @Public()
  @MessagePattern(TCP_PATTERNS.ORGANIZATION.INVOICE_SETTINGS)
  invoiceSettings() {
    return this.organizationService.invoiceSettings(requireOrganizationId());
  }

  @MessagePattern(TCP_PATTERNS.ORGANIZATION.FIND_ONE)
  @RequirePermission('platform:admin')
  findOne(@Payload() payload: RpcEnvelope<OrganizationIdGatewayRequest> | OrganizationIdGatewayRequest) {
    return this.organizationService.findOne(unwrapRpcPayload(payload).id);
  }
}

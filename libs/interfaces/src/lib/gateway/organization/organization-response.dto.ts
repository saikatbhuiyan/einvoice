import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '@libs/shared/types';
import type {
  CurrentCallerResponse,
  FindAllOrganizationsResponse,
  MembershipSummary,
  OrganizationResponse,
} from './organization.types';

export class OrganizationResponseDto implements OrganizationResponse {
  @ApiProperty({ example: '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f' })
  id!: string;

  @ApiProperty({ example: 'Acme Ltd.' })
  name!: string;

  @ApiProperty({ example: 'acme' })
  slug!: string;

  @ApiProperty({ example: 'ACME' })
  invoicePrefix!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-10-19T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-19T10:00:00.000Z' })
  updatedAt!: string;
}

export class FindAllOrganizationsResponseDto implements FindAllOrganizationsResponse {
  @ApiProperty({ type: () => OrganizationResponseDto, isArray: true })
  items!: OrganizationResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class MembershipSummaryDto implements MembershipSummary {
  @ApiProperty({ example: '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f' })
  organizationId!: string;

  @ApiProperty({ example: 'Acme Ltd.' })
  organizationName!: string;

  @ApiProperty({ example: 'accountant' })
  roleName!: string;
}

export class CurrentCallerResponseDto implements CurrentCallerResponse {
  @ApiProperty({ example: 'c3a1…' })
  userId!: string;

  @ApiProperty({ example: 'jane@acme.example' })
  username!: string;

  @ApiPropertyOptional({ example: 'jane@acme.example' })
  email?: string;

  @ApiPropertyOptional({ example: '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f' })
  activeOrganizationId?: string;

  @ApiProperty({ type: () => MembershipSummaryDto, isArray: true })
  memberships!: MembershipSummaryDto[];

  @ApiProperty({ example: ['invoice:read', 'invoice:write'], type: [String] })
  permissions!: string[];
}

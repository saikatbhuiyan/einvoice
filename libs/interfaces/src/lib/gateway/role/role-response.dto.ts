import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FindAllRolesResponse, RoleResponse } from './role.types';

export class RoleResponseDto implements RoleResponse {
  @ApiProperty({ example: '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10' })
  id!: string;

  @ApiProperty({ example: 'accountant' })
  name!: string;

  @ApiPropertyOptional({ example: 'Reads and writes invoices, reads the product catalog.' })
  description?: string;

  @ApiProperty({ example: ['invoice:read', 'invoice:write', 'product:read'], type: [String] })
  permissions!: string[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  createdAt!: string | Date;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  updatedAt!: string | Date;
}

export class FindAllRolesResponseDto implements FindAllRolesResponse {
  @ApiProperty({ type: () => RoleResponseDto, isArray: true })
  items!: RoleResponseDto[];
}

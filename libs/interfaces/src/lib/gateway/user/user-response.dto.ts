import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '@libs/shared/types';
import { RoleResponseDto } from '../role/role-response.dto';
import type { DeactivateUserResponse, FindAllUsersResponse, UserResponse } from './user.types';

export class UserResponseDto implements UserResponse {
  @ApiProperty({ example: '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10' })
  id!: string;

  @ApiProperty({ example: 'finance@acme.example', format: 'email' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ type: () => RoleResponseDto })
  role!: RoleResponseDto;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  createdAt!: string | Date;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  updatedAt!: string | Date;
}

export class FindAllUsersResponseDto implements FindAllUsersResponse {
  @ApiProperty({ type: () => UserResponseDto, isArray: true })
  items!: UserResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class DeactivateUserResponseDto implements DeactivateUserResponse {
  @ApiProperty({ example: '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10' })
  id!: string;

  @ApiProperty({ example: true })
  deactivated!: true;
}

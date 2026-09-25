import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type {
  DeactivateUserGatewayRequest,
  FindOneUserGatewayRequest,
  UpdateUserGatewayRequest,
  UserIdGatewayRequest,
} from './user.types';
import { UpdateUserDto } from './update-user.dto';

export class UserIdGatewayDto implements UserIdGatewayRequest {
  @ApiProperty({ example: '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10', description: 'User identifier (UUID).' })
  @IsUUID()
  id!: string;
}

export class FindOneUserGatewayDto extends UserIdGatewayDto implements FindOneUserGatewayRequest {}

export class DeactivateUserGatewayDto extends UserIdGatewayDto implements DeactivateUserGatewayRequest {}

export class UpdateUserGatewayDto extends UserIdGatewayDto implements UpdateUserGatewayRequest {
  @ApiProperty({ type: () => UpdateUserDto, description: 'User fields to update.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateUserDto)
  data!: UpdateUserDto;
}

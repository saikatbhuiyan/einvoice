import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import type { UpdateUserRequest } from './user.types';

export class UpdateUserDto implements UpdateUserRequest {
  @ApiPropertyOptional({ example: 'finance@acme.example', format: 'email', maxLength: 320 })
  @IsOptional()
  @Sanitize({ stripHtml: true, normalizeWhitespace: false })
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: 'Jane Doe', minLength: 1, maxLength: 160 })
  @IsOptional()
  @Sanitize()
  @IsString()
  @Length(1, 160)
  name?: string;

  @ApiPropertyOptional({ example: '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10', description: 'Id of an existing role.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

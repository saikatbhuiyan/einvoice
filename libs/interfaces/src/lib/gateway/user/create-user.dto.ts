import { IsEmail, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Sanitize } from '@libs/decorators';
import type { CreateUserRequest } from './user.types';

export class CreateUserDto implements CreateUserRequest {
  @ApiProperty({ example: 'finance@acme.example', format: 'email', maxLength: 320 })
  @Sanitize({ stripHtml: true, normalizeWhitespace: false })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'Jane Doe', minLength: 1, maxLength: 160 })
  @Sanitize()
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiProperty({
    example: '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10',
    description: 'Id of an existing role (see GET /roles).',
  })
  @IsUUID()
  roleId!: string;
}

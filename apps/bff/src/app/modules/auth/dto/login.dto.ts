import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'jane.accountant', description: "The Keycloak user's username (not email)." })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username!: string;

  @ApiProperty({ example: 'a-strong-password', format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  password!: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token — send as `Authorization: Bearer <accessToken>`.' })
  accessToken!: string;

  @ApiProperty({ description: 'Longer-lived token used to obtain a new access token without re-authenticating.' })
  refreshToken!: string;

  @ApiProperty({ example: 300, description: 'Access token lifetime in seconds.' })
  expiresIn!: number;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;
}

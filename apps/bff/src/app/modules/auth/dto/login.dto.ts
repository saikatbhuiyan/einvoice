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

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refreshToken returned by a previous login or refresh call.' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({
    description:
      'The refreshToken to invalidate. Ends the Keycloak session that token belongs to — an access token ' +
      'already issued from that session stays valid for its own remaining lifetime (a few minutes at most), ' +
      'since verification never re-checks Keycloak per request; this stops the session being refreshed further.',
  })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

// Exists purely so Swagger has a real model for logout's empty response body, instead of
// misleadingly reusing LoginResponseDto's shape.
export class LogoutResponseDto {}

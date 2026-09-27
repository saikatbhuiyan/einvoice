import { Body, Controller, Get, HttpStatus, Post, Query, Redirect } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@libs/auth';
import { ResponseMessage, SkipResponseWrap } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import { RATE_LIMIT_LOGIN_BURST, RATE_LIMIT_LOGIN_RATE } from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@ApiCorrelationIdHeader()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @RateLimit({ burst: RATE_LIMIT_LOGIN_BURST, rate: RATE_LIMIT_LOGIN_RATE })
  @ResponseMessage('Logged in successfully')
  @ApiOperation({
    summary: 'Log in',
    description:
      'Exchanges a Keycloak username and password for an access token, using the Resource Owner Password grant.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Login succeeded.',
    model: LoginResponseDto,
    message: 'Logged in successfully',
    dataExample: { accessToken: '<jwt>', refreshToken: '<refresh-jwt>', expiresIn: 300, tokenType: 'Bearer' },
  })
  @ApiProblemResponses(HttpStatus.UNAUTHORIZED)
  login(@Body() payload: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(payload);
  }

  @Public()
  @Get('login/redirect')
  @Redirect()
  @SkipResponseWrap()
  @RateLimit({ burst: RATE_LIMIT_LOGIN_BURST, rate: RATE_LIMIT_LOGIN_RATE })
  @ApiOperation({
    summary: 'Start browser login (Authorization Code flow)',
    description:
      "Redirects to Keycloak's hosted login page — the only flow that works for a federated identity provider " +
      '(e.g. Google), which has no equivalent of the username/password grant POST /auth/login uses. Keycloak ' +
      'redirects back to GET /auth/callback once the user authenticates.',
  })
  async loginRedirect(): Promise<{ url: string; statusCode: HttpStatus }> {
    const url = await this.authService.buildAuthorizationUrl();
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Public()
  @Get('callback')
  @RateLimit({ burst: RATE_LIMIT_LOGIN_BURST, rate: RATE_LIMIT_LOGIN_RATE })
  @ResponseMessage('Logged in successfully')
  @ApiOperation({
    summary: 'Complete browser login',
    description:
      'Keycloak redirects here with an authorization code after GET /auth/login/redirect. Exchanges the code ' +
      'for a token — same response shape as POST /auth/login, since this project has no frontend of its own yet ' +
      'to hand a session cookie to.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Login succeeded.',
    model: LoginResponseDto,
    message: 'Logged in successfully',
    dataExample: { accessToken: '<jwt>', refreshToken: '<refresh-jwt>', expiresIn: 300, tokenType: 'Bearer' },
  })
  @ApiProblemResponses(HttpStatus.UNAUTHORIZED)
  callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
  ): Promise<LoginResponseDto> {
    return this.authService.handleCallback(code, state);
  }
}

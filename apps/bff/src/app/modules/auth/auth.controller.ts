import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@libs/auth';
import { ResponseMessage } from '@libs/interceptors';
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
}

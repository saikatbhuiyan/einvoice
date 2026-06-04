import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@libs/interceptors';
import { SkipRateLimit } from '@libs/rate-limit';
import { ApiCorrelationIdHeader, ApiEnvelopeResponse } from './common/swagger/api-response.decorator';
import { AppService } from './app.service';

class AppStatusDto {
  @ApiProperty({ example: 'Hello API' })
  message!: string;
}

@ApiTags('System')
@ApiCorrelationIdHeader()
@SkipRateLimit()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ResponseMessage('BFF is running')
  @ApiOperation({
    summary: 'Service status',
    description: 'Returns a lightweight response that confirms the BFF HTTP process is accepting requests.',
  })
  @ApiEnvelopeResponse({
    status: 200,
    description: 'BFF status returned.',
    model: AppStatusDto,
    message: 'BFF is running',
    dataExample: { message: 'Hello API' },
  })
  getData() {
    return this.appService.getData();
  }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import {
  BaseTcpClient,
  ServiceName,
  TCP_CLIENT_TOKENS,
  TCP_PATTERNS,
  type UploadFileRequest,
  type UploadFileResponse,
} from '@libs/transports';

@Injectable()
export class MediaClientService extends BaseTcpClient {
  protected readonly logger = new Logger(MediaClientService.name);
  protected readonly serviceName = ServiceName.MEDIA;
  protected override readonly sourceService = 'invoice';

  constructor(
    @Inject(TCP_CLIENT_TOKENS[ServiceName.MEDIA])
    protected readonly client: ClientProxy,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) circuitBreakerFactory?: CircuitBreakerFactory,
  ) {
    super(circuitBreakerFactory);
  }

  async uploadFile(data: UploadFileRequest): Promise<UploadFileResponse> {
    return this.send<UploadFileResponse, UploadFileRequest>(TCP_PATTERNS.MEDIA.UPLOAD, data);
  }
}

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  TCP_PATTERNS,
  unwrapRpcPayload,
  type GetDownloadUrlRequest,
  type RpcEnvelope,
  type UploadFileRequest,
} from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { MediaService } from './media.service';

@Controller()
export class MediaRpcController {
  constructor(private readonly mediaService: MediaService) {}

  // Reuses invoice:write rather than a new media:write permission — media is only ever called
  // today as part of invoice's generate-pdf flow (see InvoiceService.generatePdf), the same
  // defense-in-depth rationale pdf-generator's own handler already documents.
  @RequirePermission('invoice:write')
  @MessagePattern(TCP_PATTERNS.MEDIA.UPLOAD)
  async upload(@Payload() payload: RpcEnvelope<UploadFileRequest> | UploadFileRequest) {
    return this.mediaService.upload(unwrapRpcPayload(payload));
  }

  // Reading a stored invoice document needs what reading the invoice needs. Like upload, only ever
  // called as part of an invoice-scoped operation (InvoiceService.getPdfDownloadUrl / send).
  @RequirePermission('invoice:read')
  @MessagePattern(TCP_PATTERNS.MEDIA.GET_DOWNLOAD_URL)
  async getDownloadUrl(@Payload() payload: RpcEnvelope<GetDownloadUrlRequest> | GetDownloadUrlRequest) {
    return this.mediaService.getDownloadUrl(unwrapRpcPayload(payload));
  }
}

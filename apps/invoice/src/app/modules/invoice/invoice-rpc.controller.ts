import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import { RequirePermission } from '@libs/auth/require-permission.decorator';
import { Public } from '@libs/auth/public.decorator';
import {
  CreateInvoiceDto,
  DeleteInvoiceGatewayDto,
  FindAllInvoicesDto,
  FindOneInvoiceGatewayDto,
  UpdateInvoiceGatewayDto,
} from '@libs/interfaces/gateway';
import { InvoiceService } from './invoice.service';

interface InvoiceIdPayload {
  id: string;
}

@Controller()
export class InvoiceRpcController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @MessagePattern(TCP_PATTERNS.INVOICE.CREATE)
  @RequirePermission('invoice:write')
  createByMessage(@Payload() payload: RpcEnvelope<CreateInvoiceDto> | CreateInvoiceDto) {
    return this.invoiceService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ALL)
  @RequirePermission('invoice:read')
  findAllByMessage(
    @Payload() payload: RpcEnvelope<FindAllInvoicesDto> | FindAllInvoicesDto = new FindAllInvoicesDto(),
  ) {
    return this.invoiceService.findAll(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ONE)
  @RequirePermission('invoice:read')
  findOneByMessage(@Payload() payload: RpcEnvelope<FindOneInvoiceGatewayDto> | FindOneInvoiceGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.invoiceService.findOne(data.id);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.UPDATE)
  @RequirePermission('invoice:write')
  updateByMessage(@Payload() payload: RpcEnvelope<UpdateInvoiceGatewayDto> | UpdateInvoiceGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.invoiceService.update(data.id, data.data, data.version);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.DELETE)
  @RequirePermission('invoice:write')
  removeByMessage(@Payload() payload: RpcEnvelope<DeleteInvoiceGatewayDto> | DeleteInvoiceGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.invoiceService.remove(data.id, data.version);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.GENERATE_PDF)
  @RequirePermission('invoice:write')
  generatePdfByMessage(@Payload() payload: RpcEnvelope<InvoiceIdPayload> | InvoiceIdPayload) {
    const data = unwrapRpcPayload(payload);
    return this.invoiceService.generatePdf(data.id);
  }

  // @Public(): payment calls this once its Stripe webhook confirms a checkout session succeeded,
  // which carries no end-user identity to forward (bff's webhook route is itself @Public(), so no
  // JwtAuthGuard ever ran to populate one) — the same "service-to-service, no permission to check"
  // exception role-grpc.controller.ts's findAllRoles already documents. Deliberately narrow (only
  // flips status to 'paid', nothing else an attacker with raw TCP access could misuse) rather than
  // widening the general-purpose UPDATE pattern, which stays permission-gated for real user edits.
  @MessagePattern(TCP_PATTERNS.INVOICE.MARK_PAID)
  @Public()
  markPaidByMessage(@Payload() payload: RpcEnvelope<InvoiceIdPayload> | InvoiceIdPayload) {
    const data = unwrapRpcPayload(payload);
    return this.invoiceService.markPaid(data.id);
  }
}

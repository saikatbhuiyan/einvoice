import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import {
  CreateInvoiceDto,
  DeleteInvoiceResponseDto,
  FindAllInvoicesDto,
  FindAllInvoicesCursorResponseDto,
  FindAllInvoicesResponseDto,
  InvoiceIdGatewayDto,
  InvoiceResponseDto,
  UpdateInvoiceDto,
} from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import {
  RATE_LIMIT_DEFAULT_BURST,
  RATE_LIMIT_DEFAULT_RATE,
  RATE_LIMIT_MUTATE_BURST,
  RATE_LIMIT_MUTATE_RATE,
  RATE_LIMIT_DELETE_BURST,
  RATE_LIMIT_DELETE_RATE,
} from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import {
  INVOICE_ID_EXAMPLE,
  CREATE_INVOICE_EXAMPLE,
  UPDATE_INVOICE_EXAMPLE,
  INVOICE_RESPONSE_EXAMPLE,
  FIND_ALL_RESPONSE_EXAMPLE,
  DELETE_INVOICE_RESPONSE_EXAMPLE,
} from './invoice.examples';
import { InvoiceService } from './invoice.service';

@ApiTags('Invoices')
@ApiCorrelationIdHeader()
@ApiBearerAuth('jwt')
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Invoice created successfully')
  @ApiOperation({
    summary: 'Create invoice',
    description: 'Creates an invoice through the invoice service and returns calculated totals.',
  })
  @ApiBody({
    type: CreateInvoiceDto,
    examples: {
      invoice: {
        summary: 'Issued invoice',
        value: CREATE_INVOICE_EXAMPLE,
      },
    },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'Invoice created.',
    model: InvoiceResponseDto,
    message: 'Invoice created successfully',
    dataExample: INVOICE_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  create(@Body() payload: CreateInvoiceDto) {
    return this.invoiceService.create(payload);
  }

  @Get()
  @RequirePermission('invoice:read')
  @ResponseMessage('Invoices retrieved successfully')
  @ApiOperation({
    summary: 'List invoices',
    description:
      'Returns invoices with pagination. Use `page` for offset pagination or `cursor` for cursor-based pagination. Do not use both.',
  })
  @ApiExtraModels(FindAllInvoicesResponseDto, FindAllInvoicesCursorResponseDto)
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoices retrieved. Meta shape depends on pagination mode.',
    model: InvoiceResponseDto,
    message: 'Invoices retrieved successfully',
    dataExample: FIND_ALL_RESPONSE_EXAMPLE,
    isArray: true,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  findAll(@Query() query: FindAllInvoicesDto, @Res({ passthrough: true }) res: Response) {
    return this.invoiceService.findAll(query, res);
  }

  @Get(':id')
  @RequirePermission('invoice:read')
  @ResponseMessage('Invoice retrieved successfully')
  @ApiOperation({
    summary: 'Get invoice',
    description: 'Returns a single invoice by its identifier.',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice retrieved.',
    model: InvoiceResponseDto,
    message: 'Invoice retrieved successfully',
    dataExample: INVOICE_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  findOne(@Param() params: InvoiceIdGatewayDto, @Res({ passthrough: true }) res: Response) {
    return this.invoiceService.findOne(params.id, res);
  }

  @Patch(':id')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Invoice updated successfully')
  @ApiOperation({
    summary: 'Update invoice',
    description:
      'Applies a partial update to a draft invoice and returns the updated record. Issued, paid, overdue and cancelled invoices are immutable (409); status changes go through the lifecycle endpoints (issue, send, cancel).',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiBody({
    type: UpdateInvoiceDto,
    examples: {
      notesUpdate: {
        summary: 'Change payment terms on a draft',
        value: UPDATE_INVOICE_EXAMPLE,
      },
    },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice updated.',
    model: InvoiceResponseDto,
    message: 'Invoice updated successfully',
    dataExample: {
      ...INVOICE_RESPONSE_EXAMPLE,
      status: 'draft',
      notes: 'Payment due within 14 days.',
      updatedAt: '2026-04-28T11:30:00.000Z',
    },
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  update(
    @Param() params: InvoiceIdGatewayDto,
    @Body() payload: UpdateInvoiceDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    const version = ifMatch ? Number(ifMatch) : undefined;
    return this.invoiceService.update(params.id, payload, isNaN(version as number) ? undefined : version);
  }

  @Delete(':id')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_DELETE_BURST, rate: RATE_LIMIT_DELETE_RATE })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invoice deleted successfully')
  @ApiOperation({
    summary: 'Delete invoice',
    description: 'Deletes an invoice and returns a confirmation payload.',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice deleted.',
    model: DeleteInvoiceResponseDto,
    message: 'Invoice deleted successfully',
    dataExample: DELETE_INVOICE_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  remove(@Param() params: InvoiceIdGatewayDto, @Headers('if-match') ifMatch?: string) {
    const version = ifMatch ? Number(ifMatch) : undefined;
    return this.invoiceService.remove(params.id, isNaN(version as number) ? undefined : version);
  }

  @Get(':id/pdf')
  @RequirePermission('invoice:read')
  @ResponseMessage('Invoice PDF link created')
  @ApiOperation({
    summary: 'Get a download link for the invoice PDF',
    description:
      'Returns a short-lived (5 minute) presigned link to the latest rendered PDF. PDFs are private: request a new link each time rather than storing one. 404 if no PDF has been generated yet.',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  getPdfDownloadUrl(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.getPdfDownloadUrl(params.id);
  }

  @Post(':id/pdf')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Invoice PDF generated successfully')
  @ApiOperation({
    summary: 'Generate invoice PDF',
    description:
      'Renders the invoice to PDF (via the pdf-generator service), stores it privately (via the media service), and returns a short-lived download link. Does not contact the client — use POST /invoices/{id}/send for that.',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE)
  generatePdf(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.generatePdf(params.id);
  }

  @Post(':id/issue')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invoice issued successfully')
  @ApiOperation({
    summary: 'Issue invoice',
    description:
      'Moves a draft invoice to issued. From then on its content is immutable (PATCH/DELETE return 409). Issuing an already-issued invoice is a no-op; any other status is a 409.',
  })
  @ApiParam({ name: 'id', example: INVOICE_ID_EXAMPLE, description: 'MongoDB ObjectId of the invoice.' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice issued.',
    model: InvoiceResponseDto,
    message: 'Invoice issued successfully',
    dataExample: INVOICE_RESPONSE_EXAMPLE,
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  issue(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.issue(params.id);
  }

  @Post(':id/cancel')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invoice cancelled successfully')
  @ApiOperation({
    summary: 'Cancel invoice',
    description:
      'Cancels an issued or overdue invoice. Paid invoices cannot be cancelled, and drafts are deleted instead (409). Cancelling an already-cancelled invoice is a no-op.',
  })
  @ApiParam({ name: 'id', example: INVOICE_ID_EXAMPLE, description: 'MongoDB ObjectId of the invoice.' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice cancelled.',
    model: InvoiceResponseDto,
    message: 'Invoice cancelled successfully',
    dataExample: { ...INVOICE_RESPONSE_EXAMPLE, status: 'cancelled' },
  })
  @ApiProblemResponses(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  cancel(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.cancel(params.id);
  }

  @Post(':id/send')
  @RequirePermission('invoice:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invoice sent successfully')
  @ApiOperation({
    summary: 'Send invoice to the client',
    description:
      'Issues the invoice if it is still a draft, renders a fresh PDF and emails it to the client (asynchronously, via the mail service). Issued and overdue invoices can be re-sent; paid and cancelled ones cannot (409).',
  })
  @ApiParam({ name: 'id', example: INVOICE_ID_EXAMPLE, description: 'MongoDB ObjectId of the invoice.' })
  @ApiProblemResponses(
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  send(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.send(params.id);
  }
}

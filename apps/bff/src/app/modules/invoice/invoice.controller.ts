import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
import { CursorPaginationMetaDto } from '@libs/shared/types';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { InvoiceService } from './invoice.service';

const invoiceIdExample = '662f9d38f2ab7c001f52c901';

const createInvoiceExample: CreateInvoiceDto = {
  invoiceNumber: 'INV-2026-0001',
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: {
    name: 'Acme Bangladesh Ltd.',
    email: 'finance@acme.example',
    address: 'House 12, Road 8, Gulshan, Dhaka 1212',
  },
  items: [
    {
      catalogId: 'SKU-SUBSCRIPTION-PRO',
      name: 'Enterprise subscription',
      quantity: 2,
      unitPrice: 15000,
      vatRate: 15,
    },
  ],
};

const updateInvoiceExample: UpdateInvoiceDto = {
  status: 'paid',
  notes: 'Paid by bank transfer.',
};

const invoiceResponseExample: InvoiceResponseDto = {
  id: invoiceIdExample,
  invoiceNumber: 'INV-2026-0001',
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: createInvoiceExample.client,
  items: [
    {
      ...createInvoiceExample.items[0],
      total: 34500,
    },
  ],
  subtotal: 30000,
  vatTotal: 4500,
  total: 34500,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
};

const findAllResponseExample: FindAllInvoicesResponseDto = {
  items: [invoiceResponseExample],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const deleteInvoiceResponseExample: DeleteInvoiceResponseDto = {
  id: invoiceIdExample,
  deleted: true,
};

@ApiTags('Invoices')
@ApiCorrelationIdHeader()
@RateLimit({ burst: 60, rate: 4 })
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  @RateLimit({ burst: 10, rate: 0.5 })
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
        value: createInvoiceExample,
      },
    },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'Invoice created.',
    model: InvoiceResponseDto,
    message: 'Invoice created successfully',
    dataExample: invoiceResponseExample,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  create(@Body() payload: CreateInvoiceDto) {
    return this.invoiceService.create(payload);
  }

  @Get()
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
    dataExample: findAllResponseExample,
    isArray: true,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY)
  findAll(@Query() query: FindAllInvoicesDto) {
    return this.invoiceService.findAll(query);
  }

  @Get(':id')
  @ResponseMessage('Invoice retrieved successfully')
  @ApiOperation({
    summary: 'Get invoice',
    description: 'Returns a single invoice by its identifier.',
  })
  @ApiParam({
    name: 'id',
    example: invoiceIdExample,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice retrieved.',
    model: InvoiceResponseDto,
    message: 'Invoice retrieved successfully',
    dataExample: invoiceResponseExample,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  findOne(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.findOne(params.id);
  }

  @Patch(':id')
  @RateLimit({ burst: 10, rate: 0.5 })
  @ResponseMessage('Invoice updated successfully')
  @ApiOperation({
    summary: 'Update invoice',
    description: 'Applies a partial update to an invoice and returns the updated record.',
  })
  @ApiParam({
    name: 'id',
    example: invoiceIdExample,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiBody({
    type: UpdateInvoiceDto,
    examples: {
      paymentUpdate: {
        summary: 'Mark invoice as paid',
        value: updateInvoiceExample,
      },
    },
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice updated.',
    model: InvoiceResponseDto,
    message: 'Invoice updated successfully',
    dataExample: {
      ...invoiceResponseExample,
      status: 'paid',
      notes: 'Paid by bank transfer.',
      updatedAt: '2026-04-28T11:30:00.000Z',
    },
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  update(@Param() params: InvoiceIdGatewayDto, @Body() payload: UpdateInvoiceDto) {
    return this.invoiceService.update(params.id, payload);
  }

  @Delete(':id')
  @RateLimit({ burst: 5, rate: 0.2 })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invoice deleted successfully')
  @ApiOperation({
    summary: 'Delete invoice',
    description: 'Deletes an invoice and returns a confirmation payload.',
  })
  @ApiParam({
    name: 'id',
    example: invoiceIdExample,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoice deleted.',
    model: DeleteInvoiceResponseDto,
    message: 'Invoice deleted successfully',
    dataExample: deleteInvoiceResponseExample,
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  remove(@Param() params: InvoiceIdGatewayDto) {
    return this.invoiceService.remove(params.id);
  }
}

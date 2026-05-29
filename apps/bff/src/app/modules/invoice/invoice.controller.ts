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
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
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
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Invoice updated successfully')
  @ApiOperation({
    summary: 'Update invoice',
    description: 'Applies a partial update to an invoice and returns the updated record.',
  })
  @ApiParam({
    name: 'id',
    example: INVOICE_ID_EXAMPLE,
    description: 'MongoDB ObjectId of the invoice.',
  })
  @ApiBody({
    type: UpdateInvoiceDto,
    examples: {
      paymentUpdate: {
        summary: 'Mark invoice as paid',
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
  update(
    @Param() params: InvoiceIdGatewayDto,
    @Body() payload: UpdateInvoiceDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    const version = ifMatch ? Number(ifMatch) : undefined;
    return this.invoiceService.update(params.id, payload, isNaN(version as number) ? undefined : version);
  }

  @Delete(':id')
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
}

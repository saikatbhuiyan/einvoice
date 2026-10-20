import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import {
  CreateCustomerDto,
  CustomerIdGatewayDto,
  CustomerResponseDto,
  DeleteCustomerResponseDto,
  FindAllCustomersDto,
  FindAllCustomersResponseDto,
  FindAllInvoicesDto,
  InvoiceResponseDto,
  UpdateCustomerDto,
} from '@libs/interfaces/gateway';
import { ResponseMessage } from '@libs/interceptors';
import { RateLimit } from '@libs/rate-limit';
import {
  RATE_LIMIT_DEFAULT_BURST,
  RATE_LIMIT_DEFAULT_RATE,
  RATE_LIMIT_DELETE_BURST,
  RATE_LIMIT_DELETE_RATE,
  RATE_LIMIT_MUTATE_BURST,
  RATE_LIMIT_MUTATE_RATE,
} from '@libs/constants';
import {
  ApiCorrelationIdHeader,
  ApiEnvelopeResponse,
  ApiProblemResponses,
} from '../../common/swagger/api-response.decorator';
import { InvoiceService } from '../invoice/invoice.service';
import { CustomerClientService } from './customer-client.service';

/**
 * The active organization's customers. An invoice can bill a customer by `customerId` instead of
 * an inline `client`; it then keeps a snapshot of the customer's details as they were, so editing
 * or deleting a customer never changes an invoice. Not cached here: lists are small and an edit
 * should show at once.
 */
@ApiTags('Customers')
@ApiCorrelationIdHeader()
@ApiBearerAuth('jwt')
@RateLimit({ burst: RATE_LIMIT_DEFAULT_BURST, rate: RATE_LIMIT_DEFAULT_RATE })
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly client: CustomerClientService,
    private readonly invoices: InvoiceService,
  ) {}

  @Post()
  @RequirePermission('customer:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Customer created successfully')
  @ApiOperation({ summary: 'Create a customer', description: 'Emails are unique per organization (409).' })
  @ApiEnvelopeResponse({
    status: HttpStatus.CREATED,
    description: 'Customer created.',
    model: CustomerResponseDto,
    message: 'Customer created successfully',
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)
  create(@Body() payload: CreateCustomerDto) {
    return this.client.createCustomer(payload);
  }

  @Get()
  @RequirePermission('customer:read')
  @ResponseMessage('Customers retrieved successfully')
  @ApiOperation({ summary: 'List customers', description: 'Sorted by name; `search` matches name, email or tax id.' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Customers retrieved.',
    model: FindAllCustomersResponseDto,
    message: 'Customers retrieved successfully',
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.BAD_GATEWAY)
  findAll(@Query() query: FindAllCustomersDto) {
    return this.client.findAllCustomers(query);
  }

  @Get(':id')
  @RequirePermission('customer:read')
  @ResponseMessage('Customer retrieved successfully')
  @ApiOperation({ summary: 'Get a customer' })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Customer retrieved.',
    model: CustomerResponseDto,
    message: 'Customer retrieved successfully',
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  findOne(@Param() params: CustomerIdGatewayDto) {
    return this.client.findOneCustomer(params.id);
  }

  @Get(':id/invoices')
  @RequirePermission('customer:read', 'invoice:read')
  @ResponseMessage('Invoices retrieved successfully')
  @ApiOperation({
    summary: "List a customer's invoices",
    description:
      'Same filters and pagination as `GET /invoices`, restricted to invoices created for this customer. 404 if the customer does not exist in the active organization.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Invoices retrieved.',
    model: InvoiceResponseDto,
    message: 'Invoices retrieved successfully',
    isArray: true,
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  async findInvoices(
    @Param() params: CustomerIdGatewayDto,
    @Query() query: FindAllInvoicesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // An unknown (or another organization's) customer is a 404, not an empty list.
    await this.client.findOneCustomer(params.id);
    return this.invoices.findAll({ ...query, customerId: params.id }, res);
  }

  @Patch(':id')
  @RequirePermission('customer:write')
  @RateLimit({ burst: RATE_LIMIT_MUTATE_BURST, rate: RATE_LIMIT_MUTATE_RATE })
  @ResponseMessage('Customer updated successfully')
  @ApiOperation({
    summary: 'Update a customer',
    description: 'Existing invoices keep the details they were issued with.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Customer updated.',
    model: CustomerResponseDto,
    message: 'Customer updated successfully',
  })
  @ApiProblemResponses(
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.BAD_GATEWAY,
  )
  update(@Param() params: CustomerIdGatewayDto, @Body() payload: UpdateCustomerDto) {
    return this.client.updateCustomer(params.id, payload);
  }

  @Delete(':id')
  @RequirePermission('customer:write')
  @RateLimit({ burst: RATE_LIMIT_DELETE_BURST, rate: RATE_LIMIT_DELETE_RATE })
  @ResponseMessage('Customer deleted successfully')
  @ApiOperation({
    summary: 'Delete a customer',
    description: 'Soft delete: their invoices are unaffected, and the email can be used for a new customer.',
  })
  @ApiEnvelopeResponse({
    status: HttpStatus.OK,
    description: 'Customer deleted.',
    model: DeleteCustomerResponseDto,
    message: 'Customer deleted successfully',
  })
  @ApiProblemResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  remove(@Param() params: CustomerIdGatewayDto) {
    return this.client.removeCustomer(params.id);
  }
}

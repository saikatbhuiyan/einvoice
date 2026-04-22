import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS } from '@libs/transports';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FindAllInvoicesDto } from './dto/find-all-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceService } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  findAll(@Query() query: FindAllInvoicesDto) {
    return this.invoiceService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoiceService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.invoiceService.update(id, updateInvoiceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoiceService.remove(id);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.CREATE)
  createByMessage(@Payload() payload: CreateInvoiceDto) {
    return this.invoiceService.create(payload);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ALL)
  findAllByMessage(@Payload() payload: FindAllInvoicesDto = new FindAllInvoicesDto()) {
    return this.invoiceService.findAll(payload);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.FIND_ONE)
  findOneByMessage(@Payload() payload: { id?: string; invoiceId?: string }) {
    return this.invoiceService.findOne(payload.id ?? payload.invoiceId ?? '');
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.UPDATE)
  updateByMessage(@Payload() payload: { id: string; data: UpdateInvoiceDto }) {
    return this.invoiceService.update(payload.id, payload.data);
  }

  @MessagePattern(TCP_PATTERNS.INVOICE.DELETE)
  removeByMessage(@Payload() payload: { id: string }) {
    return this.invoiceService.remove(payload.id);
  }
}

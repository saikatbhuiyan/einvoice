import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateInvoiceDto, FindAllInvoicesDto, UpdateInvoiceDto } from '@libs/interfaces/gateway';
import { InvoiceService } from './invoice.service';

@Controller('invoices')
export class InvoiceHttpController {
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
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto, @Headers('if-match') ifMatch?: string) {
    const version = ifMatch ? Number(ifMatch) : undefined;
    return this.invoiceService.update(id, updateInvoiceDto, isNaN(version as number) ? undefined : version);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    const version = ifMatch ? Number(ifMatch) : undefined;
    return this.invoiceService.remove(id, isNaN(version as number) ? undefined : version);
  }
}

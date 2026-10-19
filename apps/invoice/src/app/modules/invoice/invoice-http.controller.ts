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
} from '@nestjs/common';
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

  @Get(':id/pdf')
  getPdfDownloadUrl(@Param('id') id: string) {
    return this.invoiceService.getPdfDownloadUrl(id);
  }

  @Post(':id/pdf')
  generatePdf(@Param('id') id: string) {
    return this.invoiceService.generatePdf(id);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  issue(@Param('id') id: string) {
    return this.invoiceService.issue(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string) {
    return this.invoiceService.cancel(id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@Param('id') id: string) {
    return this.invoiceService.send(id);
  }
}

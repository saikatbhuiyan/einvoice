import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { INVOICE_MODEL_DEFINITION } from './invoice.schema';

@Global()
@Module({
  imports: [MongooseModule.forFeature([INVOICE_MODEL_DEFINITION])],
  exports: [MongooseModule],
})
export class SchemasModule {}

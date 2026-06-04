import { DynamicModule, Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { READ_DB } from '@libs/constants';
import { INVOICE_MODEL_DEFINITION } from './invoice.schema';
import { AUDIT_LOG_MODEL_DEFINITION } from './audit-log.schema';

@Global()
@Module({
  imports: [MongooseModule.forFeature([INVOICE_MODEL_DEFINITION, AUDIT_LOG_MODEL_DEFINITION])],
  exports: [MongooseModule],
})
export class SchemasModule {
  static forReadConnection(hasReadReplicas: boolean): DynamicModule[] {
    if (!hasReadReplicas) return [];
    return [MongooseModule.forFeature([INVOICE_MODEL_DEFINITION, AUDIT_LOG_MODEL_DEFINITION], READ_DB)];
  }
}

import { Global, Module } from '@nestjs/common';
import { SchemasModule } from '@libs/schemas';
import { AuditLogService } from './audit-log.service';

@Global()
@Module({
  imports: [SchemasModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Model } from 'mongoose';
import { AUDIT_LOG_MODEL_DEFINITION, AuditLog, AuditLogDocument } from '@libs/schemas';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @Inject(AUDIT_LOG_MODEL_DEFINITION.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async record(params: {
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    entityType: string;
    entityId: string;
    actor?: string;
    diff?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditLogModel.create({
        action: params.actor ? `${params.action}` : params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        actor: params.actor,
        diff: params.diff,
        previous: params.previous,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record audit log for ${params.entityType}:${params.entityId}: ${(error as Error).message}`,
      );
    }
  }
}

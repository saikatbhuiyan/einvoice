import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLogDocument, AuditLogModelName } from '@libs/schemas';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLogModelName)
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

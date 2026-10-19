import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditLogDocument, AuditLogModelName } from '@libs/schemas';
import { getCurrentCorrelationContext } from '@libs/logging/correlation-context';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLogModelName)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * `actor` defaults to whoever the current request is acting for — the end user's id, or
   * `service:<name>` for a service-to-service call with no user behind it (e.g. payment marking an
   * invoice paid from a Stripe webhook) — so no call site can forget to attribute an entry.
   */
  async record(params: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    actor?: string;
    diff?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditLogModel.create({
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        actor: params.actor ?? this.currentActor(),
        diff: params.diff,
        previous: params.previous,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record audit log for ${params.entityType}:${params.entityId}: ${(error as Error).message}`,
      );
    }
  }

  private currentActor(): string | undefined {
    const context = getCurrentCorrelationContext();
    if (context?.userId) return context.userId;
    return context?.sourceService ? `service:${context.sourceService}` : undefined;
  }
}

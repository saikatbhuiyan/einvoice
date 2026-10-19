import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { AuditLogDocument } from '@libs/schemas';
import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let create: jest.Mock;
  let service: AuditLogService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    service = new AuditLogService({ create } as unknown as Model<AuditLogDocument>);
  });

  afterEach(() => jest.restoreAllMocks());

  it('persists every field of the audit entry', async () => {
    await service.record({
      action: 'UPDATE',
      entityType: 'Invoice',
      entityId: 'inv-1',
      actor: 'user-1',
      diff: { status: 'paid' },
      previous: { status: 'sent' },
    });

    expect(create).toHaveBeenCalledWith({
      action: 'UPDATE',
      entityType: 'Invoice',
      entityId: 'inv-1',
      actor: 'user-1',
      diff: { status: 'paid' },
      previous: { status: 'sent' },
    });
  });

  it('attributes the entry to the user the current request acts for', async () => {
    await runWithCorrelationContext({ correlationId: 'c1', traceId: 't1', userId: 'kc-user-7' }, () =>
      service.record({ action: 'STATUS_CHANGE', entityType: 'invoice', entityId: 'inv-1' }),
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'kc-user-7' }));
  });

  // e.g. payment marking an invoice paid from a Stripe webhook: no user, but a known caller.
  it('attributes a service-to-service call with no user to the calling service', async () => {
    await runWithCorrelationContext({ correlationId: 'c1', traceId: 't1', sourceService: 'payment' }, () =>
      service.record({ action: 'STATUS_CHANGE', entityType: 'invoice', entityId: 'inv-1' }),
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'service:payment' }));
  });

  it('prefers an explicit actor over the request context', async () => {
    await runWithCorrelationContext({ correlationId: 'c1', traceId: 't1', userId: 'kc-user-7' }, () =>
      service.record({ action: 'UPDATE', entityType: 'invoice', entityId: 'inv-1', actor: 'migration-script' }),
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'migration-script' }));
  });

  it('records system actions with no actor', async () => {
    await service.record({ action: 'GENERATE_PDF', entityType: 'Invoice', entityId: 'inv-1' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_PDF', actor: undefined }));
  });

  // Auditing is best-effort by design: a Mongo hiccup on the audit collection must not fail the
  // business write that already succeeded.
  it('logs and swallows a persistence failure instead of failing the caller', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    create.mockRejectedValue(new Error('not primary'));

    await expect(
      service.record({ action: 'DELETE', entityType: 'Invoice', entityId: 'inv-9' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Failed to record audit log for Invoice:inv-9: not primary');
  });
});

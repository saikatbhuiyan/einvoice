import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { AuditLogDocument } from '@libs/schemas';
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

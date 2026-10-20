import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { InvoiceRepository } from './invoice.repository';
import type { InvoiceModel } from '@libs/schemas';

const objectId = () => new Types.ObjectId().toString();

const createFindChain = (result: unknown) => {
  const chain: Record<string, jest.Mock> = {};
  chain['sort'] = jest.fn(() => chain);
  chain['skip'] = jest.fn(() => chain);
  chain['limit'] = jest.fn(() => chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
};

describe('InvoiceRepository', () => {
  let writeModel: jest.Mocked<Pick<InvoiceModel, 'findOne' | 'create' | 'exists' | 'findOneAndUpdate'>>;
  let readModel: jest.Mocked<Pick<InvoiceModel, 'findOne' | 'find' | 'countDocuments'>>;
  let repository: InvoiceRepository;
  // Stands in for a ClientSession: transactional writes must carry exactly this object.
  const session = { id: 'session-1' };
  let transaction: jest.Mock;

  beforeEach(() => {
    // Runs the work once, as a committed transaction would (retries are the driver's business).
    transaction = jest.fn((work: (s: unknown) => Promise<unknown>) => work(session));
    writeModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      findOneAndUpdate: jest.fn(),
      db: { transaction },
    } as never;
    readModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    } as never;

    repository = new InvoiceRepository(writeModel as never, readModel as never);
  });

  describe('create', () => {
    it('short-circuits and returns the existing document when the idempotency key already matches one', async () => {
      const existing = { _id: objectId() };
      writeModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) } as never);

      const result = await repository.create({ idempotencyKey: 'key-1' } as never);

      expect(result).toBe(existing);
      // Keys are per organization: another tenant's identical key is a different request.
      expect(writeModel.findOne).toHaveBeenCalledWith({
        organizationId: ORG,
        idempotencyKey: 'key-1',
        deletedAt: null,
      });
      expect(writeModel.create).not.toHaveBeenCalled();
    });

    it('creates a new document when no idempotency key is supplied', async () => {
      const created = { _id: objectId() };
      writeModel.create.mockResolvedValue([created] as never);

      const result = await repository.create({ notes: 'n' } as never);

      expect(result).toBe(created);
      expect(writeModel.findOne).not.toHaveBeenCalled();
    });

    // The outbox event for a new invoice is written in the insert's transaction.
    it('inserts inside a transaction and runs the hook with the same session', async () => {
      const created = { _id: objectId() };
      writeModel.create.mockResolvedValue([created] as never);
      const hook = jest.fn().mockResolvedValue(undefined);

      await repository.create({ notes: 'n' } as never, hook);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(writeModel.create).toHaveBeenCalledWith([expect.objectContaining({ notes: 'n' })], { session });
      expect(hook).toHaveBeenCalledWith(created, session);
    });

    // The number is assigned on issue, from the organization's counter; a client can't pick one,
    // nor plant the invoice in another organization.
    it("stamps the caller's organization and drops a client-supplied number or organization", async () => {
      writeModel.create.mockResolvedValue([{ _id: objectId() }] as never);

      await repository.create({
        notes: 'n',
        customerId: 'cust-1',
        invoiceNumber: 'INV-2026-000001',
        organizationId: 'org-other',
        status: 'paid',
      } as never);

      const [[[stored]]] = writeModel.create.mock.calls as unknown as [[[Record<string, unknown>]]];
      expect(stored).toMatchObject({ notes: 'n', customerId: 'cust-1', organizationId: ORG });
      expect(stored).not.toHaveProperty('invoiceNumber');
      expect(stored).not.toHaveProperty('status');
    });

    test('refuses to create outside an organization context', async () => {
      await expect(repository.create({ notes: 'n' } as never)).rejects.toBeInstanceOf(MissingOrganizationContextError);
      expect(writeModel.create).not.toHaveBeenCalled();
    });

    it('fails the create if the hook fails, so neither the invoice nor its event commits', async () => {
      writeModel.create.mockResolvedValue([{ _id: objectId() }] as never);

      await expect(
        repository.create({ notes: 'n' } as never, jest.fn().mockRejectedValue(new Error('outbox down'))),
      ).rejects.toThrow('outbox down');
    });

    // An idempotent replay returns the original invoice, whose events were written when it was created.
    it('runs no hook for an idempotent replay', async () => {
      writeModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: objectId() }) } as never);
      const hook = jest.fn();

      await repository.create({ idempotencyKey: 'key-1' } as never, hook);

      expect(hook).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('applies status/currency/clientEmail/search filters and paginates by offset', async () => {
      const chain = createFindChain([{ _id: objectId() }]);
      readModel.find.mockReturnValue(chain as never);
      readModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) } as never);

      const result = await repository.findAll({
        page: 2,
        limit: 10,
        status: 'issued',
        currency: 'USD',
        clientEmail: 'Client@Example.com',
        search: 'acme',
        customerId: 'cust-1',
      });

      expect(readModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          customerId: 'cust-1',
          deletedAt: null,
          status: 'issued',
          currency: 'USD',
          'client.email': 'client@example.com',
          $or: expect.any(Array),
        }),
      );
      expect(chain['skip']).toHaveBeenCalledWith(10);
      expect(chain['limit']).toHaveBeenCalledWith(10);
      expect(result.meta).toMatchObject({ mode: 'offset', page: 2, limit: 10, total: 1 });
    });

    it('paginates by cursor and reports hasNextPage when an extra item is fetched', async () => {
      const cursorId = objectId();
      const items = [{ _id: objectId() }, { _id: objectId() }];
      const chain = createFindChain(items);
      readModel.find.mockReturnValue(chain as never);

      const result = await repository.findAll({
        limit: 1,
        cursor: Buffer.from(cursorId).toString('base64url'),
      });

      expect(result.meta).toMatchObject({ mode: 'cursor', limit: 1, hasNextPage: true });
      expect(result.items).toHaveLength(1);
    });

    it('rejects an invalid cursor', async () => {
      await expect(repository.findAll({ cursor: 'not-a-valid-cursor' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('returns null for a malformed id without querying the database', async () => {
      const result = await repository.findOne('not-an-object-id');

      expect(result).toBeNull();
      expect(readModel.findOne).not.toHaveBeenCalled();
    });
  });

  // A Mongoose query stub: awaitable via exec(), and chainable through select() (used when a
  // missed conditional write re-reads the document to explain why).
  const query = (result: unknown) => {
    const exec = jest.fn().mockResolvedValue(result);
    const chain = { exec, select: jest.fn(() => chain), session: jest.fn(() => chain) };
    return chain;
  };

  describe('update', () => {
    it('only matches a draft at the given version, then saves', async () => {
      const id = objectId();
      const invoiceDoc = { set: jest.fn(), save: jest.fn().mockResolvedValue(undefined) };
      writeModel.findOne.mockReturnValue(query(invoiceDoc) as never);

      const result = await repository.update(id, { notes: 'updated' }, 3);

      expect(writeModel.findOne).toHaveBeenCalledWith({
        _id: id,
        organizationId: ORG,
        deletedAt: null,
        status: { $in: ['draft'] },
        version: 3,
      });
      expect(invoiceDoc.set).toHaveBeenCalledWith({ notes: 'updated' });
      expect(invoiceDoc.save).toHaveBeenCalled();
      expect(result).toBe(invoiceDoc);
    });

    // RPC payloads skip DTO validation, so the repository is the boundary that keeps a caller from
    // writing status (or deletedAt, pdfUrl, version...) through a content edit.
    it('persists only content fields, dropping status and bookkeeping fields from the payload', async () => {
      const invoiceDoc = { set: jest.fn(), save: jest.fn().mockResolvedValue(undefined) };
      writeModel.findOne.mockReturnValue(query(invoiceDoc) as never);

      await repository.update(objectId(), {
        notes: 'n',
        status: 'paid',
        deletedAt: new Date(),
        pdfUrl: 'https://evil.test/x.pdf',
        version: 99,
        total: 0,
      } as never);

      expect(invoiceDoc.set).toHaveBeenCalledWith({ notes: 'n' });
    });

    it('refuses to edit an invoice that is no longer a draft', async () => {
      const id = objectId();
      writeModel.findOne
        .mockReturnValueOnce(query(null) as never)
        .mockReturnValueOnce(query({ status: 'issued', version: 2 }) as never);

      await expect(repository.update(id, { notes: 'x' })).rejects.toThrow(
        new ConflictException('Invoice is issued; only draft invoices can be edited. Issued invoices are immutable.'),
      );
    });

    it('throws ConflictException when a version is given but the document has since moved on', async () => {
      const id = objectId();
      writeModel.findOne
        .mockReturnValueOnce(query(null) as never)
        .mockReturnValueOnce(query({ status: 'draft', version: 2 }) as never);

      await expect(repository.update(id, {}, 1)).rejects.toThrow(/modified by another user/);
    });

    it('returns null when the document truly does not exist', async () => {
      writeModel.findOne.mockReturnValueOnce(query(null) as never).mockReturnValueOnce(query(null) as never);

      const result = await repository.update(objectId(), {}, 1);

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('soft-deletes, and only a draft', async () => {
      const id = objectId();
      const deleted = { _id: id, deletedAt: new Date() };
      writeModel.findOneAndUpdate.mockReturnValue(query(deleted) as never);

      const result = await repository.remove(id);

      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, organizationId: ORG, deletedAt: null, status: { $in: ['draft'] } },
        { deletedAt: expect.any(Date) },
        { returnDocument: 'after' },
      );
      expect(result).toBe(deleted);
    });

    it('refuses to delete a paid invoice', async () => {
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
      writeModel.findOne.mockReturnValue(query({ status: 'paid', version: 4 }) as never);

      await expect(repository.remove(objectId())).rejects.toThrow(
        /Invoice is paid; only draft invoices can be deleted/,
      );
    });

    it('throws ConflictException on a version mismatch against a still-existing document', async () => {
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
      writeModel.findOne.mockReturnValue(query({ status: 'draft', version: 6 }) as never);

      await expect(repository.remove(objectId(), 5)).rejects.toThrow(/modified by another user/);
    });

    it('returns null when the document is already gone', async () => {
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
      writeModel.findOne.mockReturnValue(query(null) as never);

      const result = await repository.remove(objectId(), 5);

      expect(result).toBeNull();
    });
  });

  describe('setPdfMetadata', () => {
    it('records the key in a transaction and runs the hook with the stored invoice and session', async () => {
      const id = objectId();
      const stored = { _id: id, pdfKey: 'invoices/u/x.pdf' };
      writeModel.findOneAndUpdate.mockReturnValue(query(stored) as never);
      const hook = jest.fn().mockResolvedValue(undefined);
      const at = new Date('2026-10-19T10:00:00.000Z');

      const result = await repository.setPdfMetadata(id, 'invoices/u/x.pdf', at, hook);

      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, organizationId: ORG, deletedAt: null },
        { $set: { pdfKey: 'invoices/u/x.pdf', pdfGeneratedAt: at } },
        { returnDocument: 'after', session },
      );
      expect(hook).toHaveBeenCalledWith(stored, session);
      expect(result).toBe(stored);
    });

    it('runs no hook when the invoice is gone', async () => {
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
      const hook = jest.fn();

      await expect(repository.setPdfMetadata(objectId(), 'k', new Date(), hook)).resolves.toBeNull();
      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe('transitionStatus', () => {
    const current = (status: string, version = 3) => ({ _id: objectId(), status, version });

    it('reads the invoice in the transaction, then moves it from an allowed status guarded on that read', async () => {
      const id = objectId();
      const after = { _id: id, status: 'paid' };
      writeModel.findOne.mockReturnValue(query(current('overdue')) as never);
      writeModel.findOneAndUpdate.mockReturnValue(query(after) as never);
      const inTransaction = jest.fn().mockResolvedValue(undefined);

      const result = await repository.transitionStatus(id, ['issued', 'overdue'], 'paid', { inTransaction });

      expect(writeModel.findOne).toHaveBeenCalledWith({ _id: id, organizationId: ORG, deletedAt: null });
      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, organizationId: ORG, deletedAt: null, status: 'overdue', version: 3 },
        { $set: { status: 'paid' }, $inc: { version: 1 } },
        { returnDocument: 'after', session },
      );
      expect(result).toEqual({ outcome: 'transitioned', invoice: after, from: 'overdue' });
      // e.g. invoice.cancelled is enqueued in the same transaction as the status change.
      expect(inTransaction).toHaveBeenCalledWith(after, session);
    });

    // Issuing: the number and issue date are written by the same update as the status.
    it('writes the fields prepare returns, computed from the current invoice inside the transaction', async () => {
      const draft = current('draft');
      writeModel.findOne.mockReturnValue(query(draft) as never);
      writeModel.findOneAndUpdate.mockReturnValue(query({ status: 'issued' }) as never);
      const issueDate = new Date('2026-10-19T10:00:00.000Z');
      const prepare = jest.fn().mockResolvedValue({ invoiceNumber: 'INV-2026-000007', issueDate });

      await repository.transitionStatus(objectId(), ['draft'], 'issued', { prepare });

      expect(prepare).toHaveBeenCalledWith(draft, session);
      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { invoiceNumber: 'INV-2026-000007', issueDate, status: 'issued' }, $inc: { version: 1 } },
        expect.anything(),
      );
    });

    // The status is checked before prepare runs, so a refused issue never touches the counter.
    it('rejects, returning the current state, without running prepare or the hook', async () => {
      const cancelled = current('cancelled');
      writeModel.findOne.mockReturnValue(query(cancelled) as never);
      const prepare = jest.fn();
      const inTransaction = jest.fn();

      const result = await repository.transitionStatus(objectId(), ['issued', 'overdue'], 'paid', {
        prepare,
        inTransaction,
      });

      expect(result).toEqual({ outcome: 'rejected', invoice: cancelled });
      expect(prepare).not.toHaveBeenCalled();
      expect(inTransaction).not.toHaveBeenCalled();
      expect(writeModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fails the whole transition when prepare refuses (nothing is written)', async () => {
      writeModel.findOne.mockReturnValue(query(current('draft')) as never);
      const refusal = new ConflictException('due date in the past');

      await expect(
        repository.transitionStatus(objectId(), ['draft'], 'issued', { prepare: jest.fn().mockRejectedValue(refusal) }),
      ).rejects.toBe(refusal);
      expect(writeModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('is a 409 if the invoice changed between the read and the guarded write', async () => {
      writeModel.findOne.mockReturnValue(query(current('draft')) as never);
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);

      await expect(repository.transitionStatus(objectId(), ['draft'], 'issued')).rejects.toThrow(
        /modified by another user/,
      );
    });

    it('reports not_found for a missing invoice or a malformed id', async () => {
      writeModel.findOne.mockReturnValue(query(null) as never);

      await expect(repository.transitionStatus(objectId(), ['draft'], 'issued')).resolves.toEqual({
        outcome: 'not_found',
      });
      await expect(repository.transitionStatus('nope', ['draft'], 'issued')).resolves.toEqual({
        outcome: 'not_found',
      });
    });
  });
});

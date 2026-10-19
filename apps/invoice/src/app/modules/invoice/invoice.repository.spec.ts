import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
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

  beforeEach(() => {
    writeModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      findOneAndUpdate: jest.fn(),
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
      expect(writeModel.create).not.toHaveBeenCalled();
    });

    it('creates a new document when no idempotency key is supplied', async () => {
      const created = { _id: objectId() };
      writeModel.create.mockResolvedValue(created as never);

      const result = await repository.create({ invoiceNumber: 'INV-0001' } as never);

      expect(result).toBe(created);
      expect(writeModel.findOne).not.toHaveBeenCalled();
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
      });

      expect(readModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
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
    return { exec, select: jest.fn(() => ({ exec })) };
  };

  describe('update', () => {
    it('only matches a draft at the given version, then saves', async () => {
      const id = objectId();
      const invoiceDoc = { set: jest.fn(), save: jest.fn().mockResolvedValue(undefined) };
      writeModel.findOne.mockReturnValue(query(invoiceDoc) as never);

      const result = await repository.update(id, { notes: 'updated' }, 3);

      expect(writeModel.findOne).toHaveBeenCalledWith({
        _id: id,
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
        { _id: id, deletedAt: null, status: { $in: ['draft'] } },
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

  describe('transitionStatus', () => {
    it('changes status only from an allowed status, bumps version, and reports where it came from', async () => {
      const id = objectId();
      const after = { _id: id, status: 'paid' };
      writeModel.findOneAndUpdate.mockReturnValue(query({ _id: id, status: 'overdue' }) as never);
      writeModel.findOne.mockReturnValue(query(after) as never);

      const result = await repository.transitionStatus(id, ['issued', 'overdue'], 'paid');

      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, deletedAt: null, status: { $in: ['issued', 'overdue'] } },
        { $set: { status: 'paid' }, $inc: { version: 1 } },
        { returnDocument: 'before' },
      );
      expect(result).toEqual({ outcome: 'transitioned', invoice: after, from: 'overdue' });
    });

    it('rejects, returning the current state, when the invoice is not in an allowed status', async () => {
      const current = { status: 'cancelled' };
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
      writeModel.findOne.mockReturnValue(query(current) as never);

      const result = await repository.transitionStatus(objectId(), ['issued', 'overdue'], 'paid');

      expect(result).toEqual({ outcome: 'rejected', invoice: current });
    });

    it('reports not_found for a missing invoice or a malformed id', async () => {
      writeModel.findOneAndUpdate.mockReturnValue(query(null) as never);
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

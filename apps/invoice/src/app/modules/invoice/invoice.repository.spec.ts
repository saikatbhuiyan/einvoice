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

  describe('update', () => {
    it('applies the version filter and saves when the document exists', async () => {
      const id = objectId();
      const invoiceDoc = {
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };
      writeModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(invoiceDoc) } as never);

      const result = await repository.update(id, { notes: 'updated' }, 3);

      expect(writeModel.findOne).toHaveBeenCalledWith({ _id: id, deletedAt: null, version: 3 });
      expect(invoiceDoc.set).toHaveBeenCalled();
      expect(invoiceDoc.save).toHaveBeenCalled();
      expect(result).toBe(invoiceDoc);
    });

    it('throws ConflictException when a version is given but the document has since moved on', async () => {
      const id = objectId();
      writeModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) } as never);
      writeModel.exists.mockResolvedValue({ _id: id } as never);

      await expect(repository.update(id, {}, 1)).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns null when the document truly does not exist', async () => {
      const id = objectId();
      writeModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) } as never);
      writeModel.exists.mockResolvedValue(null);

      const result = await repository.update(id, {}, 1);

      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('sets deletedAt instead of hard-deleting the document', async () => {
      const id = objectId();
      const deleted = { _id: id, deletedAt: new Date() };
      writeModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(deleted) } as never);

      const result = await repository.remove(id);

      expect(writeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, deletedAt: null },
        { deletedAt: expect.any(Date) },
        { new: true },
      );
      expect(result).toBe(deleted);
    });

    it('throws ConflictException on a version mismatch against a still-existing document', async () => {
      const id = objectId();
      writeModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) } as never);
      writeModel.exists.mockResolvedValue({ _id: id } as never);

      await expect(repository.remove(id, 5)).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns null when the document is already gone', async () => {
      const id = objectId();
      writeModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) } as never);
      writeModel.exists.mockResolvedValue(null);

      const result = await repository.remove(id, 5);

      expect(result).toBeNull();
    });
  });
});

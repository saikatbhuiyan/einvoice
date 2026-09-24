import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { InvoiceService } from './invoice.service';
import { IInvoiceRepository } from './invoice.repository.interface';

type MockCache = { get: jest.Mock; set: jest.Mock; del: jest.Mock };
type MockRedis = { get: jest.Mock; incr: jest.Mock };
type MockAuditLog = { record: jest.Mock };

const buildInvoiceDoc = (overrides: Record<string, unknown> = {}) => {
  const base = {
    _id: { toString: () => overrides['id'] ?? 'invoice-1' },
    toJSON: () => ({ id: overrides['id'] ?? 'invoice-1', invoiceNumber: 'INV-0001', ...overrides }),
  };
  return base as unknown as Awaited<ReturnType<IInvoiceRepository['create']>>;
};

describe('InvoiceService', () => {
  let repository: jest.Mocked<IInvoiceRepository>;
  let cacheManager: MockCache;
  let redis: MockRedis;
  let auditLog: MockAuditLog;
  let service: InvoiceService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn().mockResolvedValue(1) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new InvoiceService(repository, cacheManager as never, redis as never, auditLog as never);
  });

  describe('create', () => {
    it('persists, bumps the list version, and records an audit entry', async () => {
      const created = buildInvoiceDoc({ id: 'invoice-1' });
      repository.create.mockResolvedValue(created);

      const result = await service.create({ invoiceNumber: 'INV-0001' } as never);

      expect(result).toEqual(created.toJSON());
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'invoice', entityId: 'invoice-1' }),
      );
    });

    it('maps a duplicate invoiceNumber error to ConflictException', async () => {
      repository.create.mockRejectedValue({
        code: 11000,
        keyPattern: { invoiceNumber: 1 },
        keyValue: { invoiceNumber: 'INV-0001' },
      });

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a Mongoose ValidationError to UnprocessableEntityException', async () => {
      const validationError = new MongooseError.ValidationError();
      validationError.errors = {
        dueDate: new MongooseError.ValidatorError({
          message: 'dueDate cannot be earlier than issueDate.',
          path: 'dueDate',
        }),
      };
      repository.create.mockRejectedValue(validationError);

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rethrows unrecognized errors as-is', async () => {
      const unexpected = new Error('boom');
      repository.create.mockRejectedValue(unexpected);

      await expect(service.create({ invoiceNumber: 'INV-0001' } as never)).rejects.toBe(unexpected);
    });
  });

  describe('findAll', () => {
    it('returns a cached response without hitting the repository', async () => {
      const cached = {
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
      };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findAll({});

      expect(result).toBe(cached);
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('builds and caches an offset-mode response on a cache miss', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findAll.mockResolvedValue({
        items: [doc],
        meta: {
          mode: 'offset',
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toEqual([doc.toJSON()]);
      expect('cursor' in result.meta).toBe(false);
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('builds and caches a cursor-mode response on a cache miss', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findAll.mockResolvedValue({
        items: [doc],
        meta: { mode: 'cursor', limit: 20, hasNextPage: true, cursor: 'abc' },
      });

      const result = await service.findAll({ cursor: undefined });

      expect(result.meta).toEqual({ limit: 20, hasNextPage: true, cursor: 'abc' });
      expect(cacheManager.set).toHaveBeenCalled();
    });

    it('tolerates cache read/write failures without throwing', async () => {
      cacheManager.get.mockRejectedValue(new Error('cache down'));
      cacheManager.set.mockRejectedValue(new Error('cache down'));
      repository.findAll.mockResolvedValue({
        items: [],
        meta: {
          mode: 'offset',
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      await expect(service.findAll({})).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns a cached response without hitting the repository', async () => {
      const cached = { id: 'invoice-1' };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.findOne('507f1f77bcf86cd799439011');

      expect(result).toBe(cached);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for a malformed id before touching the repository', async () => {
      await expect(service.findOne('not-an-object-id')).rejects.toThrow(
        '"not-an-object-id" is not a valid invoice id.',
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the repository returns null', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('caches the response on a successful lookup', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      const doc = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findOne.mockResolvedValue(doc);

      const result = await service.findOne('507f1f77bcf86cd799439011');

      expect(result).toEqual(doc.toJSON());
      expect(cacheManager.set).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('invalidates the entity cache, bumps the list version, and records an audit entry', async () => {
      const previous = buildInvoiceDoc({ id: 'invoice-1' });
      const updated = buildInvoiceDoc({ id: 'invoice-1', invoiceNumber: 'INV-0002' });
      repository.findOne.mockResolvedValue(previous);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('507f1f77bcf86cd799439011', {}, 3);

      expect(result).toEqual(updated.toJSON());
      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    });

    it('throws NotFoundException when the repository finds nothing to update', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.update.mockResolvedValue(null);

      await expect(service.update('507f1f77bcf86cd799439011', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates a ConflictException from a stale If-Match version', async () => {
      repository.findOne.mockResolvedValue(buildInvoiceDoc());
      repository.update.mockRejectedValue(new ConflictException('stale version'));

      await expect(service.update('507f1f77bcf86cd799439011', {}, 1)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('soft-deletes, invalidates cache, bumps the list version, and records an audit entry', async () => {
      const previous = buildInvoiceDoc({ id: 'invoice-1' });
      repository.findOne.mockResolvedValue(previous);
      repository.remove.mockResolvedValue(previous);

      const result = await service.remove('507f1f77bcf86cd799439011', 2);

      expect(result).toEqual({ id: '507f1f77bcf86cd799439011', deleted: true });
      expect(cacheManager.del).toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
    });

    it('throws NotFoundException when there is nothing left to delete', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.remove.mockResolvedValue(null);

      await expect(service.remove('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

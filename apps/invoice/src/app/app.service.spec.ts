import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;
  const mongoConnectionMock = {
    readyState: 1,
    db: {
      databaseName: 'einvoice_dev',
      admin: () => ({
        ping: jest.fn().mockResolvedValue({ ok: 1 }),
      }),
    },
  };

  beforeAll(async () => {
    const app = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: getConnectionToken(),
          useValue: mongoConnectionMock,
        },
      ],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  describe('getData', () => {
    it('should return "Hello API"', () => {
      expect(service.getData()).toEqual({ message: 'Hello API' });
    });
  });

  describe('getHealth', () => {
    it('should report mongo health', async () => {
      await expect(service.getHealth()).resolves.toMatchObject({
        service: 'invoice',
        status: 'ok',
        mongo: {
          status: 'up',
          readyState: 1,
          dbName: 'einvoice_dev',
        },
      });
    });
  });
});

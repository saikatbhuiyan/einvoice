import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  const healthResponse = {
    service: 'invoice',
    status: 'ok',
    timestamp: '2026-04-18T00:00:00.000Z',
    mongo: {
      status: 'up',
      readyState: 1,
      dbName: 'einvoice_dev',
    },
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getData: () => ({ message: 'Hello API' }),
            getHealth: jest.fn().mockResolvedValue(healthResponse),
          },
        },
      ],
    }).compile();
  });

  describe('getData', () => {
    it('should return "Hello API"', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getData()).toEqual({ message: 'Hello API' });
    });
  });

  describe('getHealth', () => {
    it('should return service health', async () => {
      const appController = app.get<AppController>(AppController);
      await expect(appController.getHealth()).resolves.toEqual(healthResponse);
    });
  });
});

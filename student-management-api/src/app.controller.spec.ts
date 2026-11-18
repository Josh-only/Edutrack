import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  let healthQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    healthQuery = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: { query: healthQuery } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('checks the database connection', async () => {
      await expect(appController.getHealth()).resolves.toEqual({ status: 'ok' });
      expect(healthQuery).toHaveBeenCalledWith('SELECT 1');
    });
  });
});

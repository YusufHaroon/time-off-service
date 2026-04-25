import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';

// Set env vars before any imports resolve ConfigService
process.env.DATABASE_PATH = ':memory:';
process.env.HCM_BASE_URL = 'http://hcm-integration-test.local';
process.env.HCM_API_KEY = 'int-test-key';
process.env.HCM_TIMEOUT_MS = '3000';
process.env.HCM_RETRY_ATTEMPTS = '3';

describe('AppModule integration', () => {
  let moduleRef;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('compiles the full module graph', () => {
    expect(moduleRef).toBeDefined();
  });

  it('provides HealthService with a working check()', async () => {
    const service = moduleRef.get(HealthService);
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(typeof result.timestamp).toBe('string');
  });

  it('registers HealthController and its check() delegates to the service', async () => {
    const controller = moduleRef.get(HealthController);
    const result = await controller.check();
    expect(result.status).toBe('ok');
  });
});

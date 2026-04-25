import 'reflect-metadata';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns ok status with connected database', async () => {
    const mockDataSource = { query: jest.fn().mockResolvedValue([{ 1: 1 }]) };
    const service = new HealthService(mockDataSource);
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(typeof result.timestamp).toBe('string');
    expect(mockDataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns disconnected when DB query throws', async () => {
    const mockDataSource = { query: jest.fn().mockRejectedValue(new Error('connection lost')) };
    const service = new HealthService(mockDataSource);
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('disconnected');
  });
});

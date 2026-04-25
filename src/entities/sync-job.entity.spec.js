import 'reflect-metadata';
import { SyncJob, SyncJobType, SyncJobStatus } from './sync-job.entity';

describe('SyncJob entity', () => {
  it('exports all SyncJobType values', () => {
    expect(Object.values(SyncJobType)).toEqual(
      expect.arrayContaining(['BATCH', 'SCHEDULED', 'MANUAL']),
    );
  });

  it('exports all SyncJobStatus values', () => {
    expect(Object.values(SyncJobStatus)).toEqual(
      expect.arrayContaining(['RUNNING', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED']),
    );
  });

  it('can be instantiated', () => {
    const job = new SyncJob();
    expect(job).toBeDefined();
  });
});

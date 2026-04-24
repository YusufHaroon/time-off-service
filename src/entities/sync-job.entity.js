import 'reflect-metadata';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** @enum {string} */
export const SyncJobType = Object.freeze({
  BATCH: 'BATCH',
  SCHEDULED: 'SCHEDULED',
  MANUAL: 'MANUAL',
});

/** @enum {string} */
export const SyncJobStatus = Object.freeze({
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
  FAILED: 'FAILED',
});

@Entity('sync_job')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid')
  id;

  /** @type {keyof typeof SyncJobType} */
  @Column({ type: 'simple-enum', enum: Object.values(SyncJobType) })
  type;

  /** @type {keyof typeof SyncJobStatus} */
  @Column({ type: 'simple-enum', enum: Object.values(SyncJobStatus) })
  status;

  @Column({ type: 'int', default: 0 })
  recordsProcessed;

  @Column({ type: 'int', default: 0 })
  recordsFailed;

  @Column({ type: 'text', nullable: true })
  errorSummary;

  @Column({ type: 'datetime' })
  startedAt;

  @Column({ type: 'datetime', nullable: true })
  finishedAt;
}

import 'reflect-metadata';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/** @enum {string} */
export const AuditEntityType = Object.freeze({
  BALANCE: 'BALANCE',
  REQUEST: 'REQUEST',
});

/** @enum {string} */
export const AuditAction = Object.freeze({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DEDUCTED: 'DEDUCTED',
  RESTORED: 'RESTORED',
  SYNCED: 'SYNCED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
});

/** @enum {string} */
export const AuditSource = Object.freeze({
  USER: 'USER',
  HCM_REALTIME: 'HCM_REALTIME',
  HCM_BATCH: 'HCM_BATCH',
  SCHEDULED_SYNC: 'SCHEDULED_SYNC',
  SYSTEM: 'SYSTEM',
});

/**
 * Append-only audit trail. Never issue UPDATE or DELETE on this table.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id;

  /** @type {keyof typeof AuditEntityType} */
  @Column({ type: 'simple-enum', enum: Object.values(AuditEntityType) })
  entityType;

  @Column({ type: 'varchar' })
  entityId;

  /** @type {keyof typeof AuditAction} */
  @Column({ type: 'simple-enum', enum: Object.values(AuditAction) })
  action;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  deltaDays;

  @Column({ type: 'varchar' })
  actor;

  /** @type {keyof typeof AuditSource} */
  @Column({ type: 'simple-enum', enum: Object.values(AuditSource) })
  source;

  /** Serialized JSON string. */
  @Column({ type: 'text', nullable: true })
  metadata;

  @CreateDateColumn()
  createdAt;
}

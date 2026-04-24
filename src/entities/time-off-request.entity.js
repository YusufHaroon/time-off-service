import 'reflect-metadata';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeaveType } from './balance.entity';

/** @enum {string} */
export const RequestStatus = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PENDING_HCM: 'PENDING_HCM',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

@Entity('time_off_request')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id;

  @Column({ type: 'varchar' })
  employeeId;

  @Column({ type: 'varchar', nullable: true })
  managerId;

  @Column({ type: 'varchar' })
  locationId;

  /** @type {keyof typeof LeaveType} */
  @Column({ type: 'simple-enum', enum: Object.values(LeaveType) })
  leaveType;

  @Column({ type: 'date' })
  startDate;

  @Column({ type: 'date' })
  endDate;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  daysRequested;

  /** @type {keyof typeof RequestStatus} */
  @Column({ type: 'simple-enum', enum: Object.values(RequestStatus), default: RequestStatus.DRAFT })
  status;

  @Column({ type: 'varchar', nullable: true })
  hcmReferenceId;

  @Column({ type: 'text', nullable: true })
  rejectionReason;

  @Column({ type: 'int', default: 0 })
  retryCount;

  @CreateDateColumn()
  createdAt;

  @UpdateDateColumn()
  updatedAt;
}

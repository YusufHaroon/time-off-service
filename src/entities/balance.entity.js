import 'reflect-metadata';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Unique,
} from 'typeorm';

/** @enum {string} */
export const LeaveType = Object.freeze({
  ANNUAL: 'ANNUAL',
  SICK: 'SICK',
  MATERNITY: 'MATERNITY',
  PATERNITY: 'PATERNITY',
  UNPAID: 'UNPAID',
});

@Entity('balance')
@Unique(['employeeId', 'locationId', 'leaveType'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id;

  @Column({ type: 'varchar' })
  employeeId;

  @Column({ type: 'varchar' })
  locationId;

  /** @type {keyof typeof LeaveType} */
  @Column({ type: 'simple-enum', enum: Object.values(LeaveType) })
  leaveType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalDays;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  usedDays;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  pendingDays;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt;

  /** Optimistic lock — auto-incremented by TypeORM on each save, starts at 1. */
  @VersionColumn()
  version;

  @CreateDateColumn()
  createdAt;

  @UpdateDateColumn()
  updatedAt;

  /** @returns {number} */
  get availableDays() {
    return Number(this.totalDays) - Number(this.usedDays) - Number(this.pendingDays);
  }
}

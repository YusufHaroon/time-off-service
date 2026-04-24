import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { Balance, LeaveType } from '../entities/balance.entity';
import { AuditLog, AuditEntityType, AuditAction, AuditSource } from '../entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from './balance.service';

describe('BalanceService', () => {
  let app;
  let service;
  let balanceRepo;
  let auditRepo;

  /** Creates a persisted Balance, merging caller-supplied overrides. */
  async function seed(overrides = {}) {
    const record = balanceRepo.create({
      employeeId: `emp-${Math.random().toString(36).slice(2, 9)}`,
      locationId: 'loc-hq',
      leaveType: LeaveType.ANNUAL,
      totalDays: 20,
      usedDays: 0,
      pendingDays: 0,
      ...overrides,
    });
    return balanceRepo.save(record);
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Balance, AuditLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Balance, AuditLog]),
      ],
      providers: [
        {
          provide: AuditService,
          useFactory: (repo) => new AuditService(repo),
          inject: [getRepositoryToken(AuditLog)],
        },
        {
          provide: BalanceService,
          useFactory: (bRepo, auditSvc) => new BalanceService(bRepo, auditSvc),
          inject: [getRepositoryToken(Balance), AuditService],
        },
      ],
    }).compile();

    service = app.get(BalanceService);
    balanceRepo = app.get(getRepositoryToken(Balance));
    auditRepo = app.get(getRepositoryToken(AuditLog));
  });

  afterAll(() => app.close());

  // ---------------------------------------------------------------------------
  // getBalance
  // ---------------------------------------------------------------------------

  describe('getBalance', () => {
    it('returns the correct record', async () => {
      const bal = await seed({ employeeId: 'emp-gb-1', totalDays: 15 });
      const result = await service.getBalance('emp-gb-1', 'loc-hq', LeaveType.ANNUAL);
      expect(result.id).toBe(bal.id);
      expect(Number(result.totalDays)).toBe(15);
    });

    it('throws NotFoundException for an unknown employee', async () => {
      await expect(
        service.getBalance('nobody', 'loc-hq', LeaveType.ANNUAL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getBalancesForEmployee
  // ---------------------------------------------------------------------------

  describe('getBalancesForEmployee', () => {
    it('returns all balances for an employee', async () => {
      const empId = 'emp-multi';
      await seed({ employeeId: empId, leaveType: LeaveType.ANNUAL });
      await seed({ employeeId: empId, leaveType: LeaveType.SICK });
      const results = await service.getBalancesForEmployee(empId);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.employeeId === empId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // deduct
  // ---------------------------------------------------------------------------

  describe('deduct', () => {
    it('reduces availableDays by adding to pendingDays', async () => {
      const bal = await seed({ totalDays: 20, usedDays: 2, pendingDays: 0 });
      const result = await service.deduct(bal.id, 5, 'actor', AuditSource.USER);
      expect(Number(result.pendingDays)).toBe(5);
      expect(result.availableDays).toBe(13); // 20 - 2 - 5
    });

    it('throws UnprocessableEntityException when balance is insufficient', async () => {
      // availableDays = 5 - 3 - 1 = 1
      const bal = await seed({ totalDays: 5, usedDays: 3, pendingDays: 1 });
      await expect(
        service.deduct(bal.id, 5, 'actor', AuditSource.USER),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('retries on version conflict and eventually throws ConflictException', async () => {
      const bal = await seed({ totalDays: 20 });

      const executeMock = jest.fn().mockResolvedValue({ affected: 0 });
      const qbMock = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: executeMock,
      };
      const createQBSpy = jest.spyOn(balanceRepo, 'createQueryBuilder').mockReturnValue(qbMock);

      try {
        await expect(
          service.deduct(bal.id, 5, 'actor', AuditSource.USER),
        ).rejects.toThrow(ConflictException);
        expect(executeMock).toHaveBeenCalledTimes(3);
      } finally {
        createQBSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // confirmDeduction
  // ---------------------------------------------------------------------------

  describe('confirmDeduction', () => {
    it('moves days from pendingDays to usedDays', async () => {
      const bal = await seed({ totalDays: 20, usedDays: 2, pendingDays: 5 });
      const result = await service.confirmDeduction(bal.id, 5, 'actor', AuditSource.USER);
      expect(Number(result.usedDays)).toBe(7);   // 2 + 5
      expect(Number(result.pendingDays)).toBe(0); // 5 - 5
    });
  });

  // ---------------------------------------------------------------------------
  // restore
  // ---------------------------------------------------------------------------

  describe('restore', () => {
    it('decrements usedDays', async () => {
      const bal = await seed({ totalDays: 20, usedDays: 8 });
      const result = await service.restore(bal.id, 3, 'actor', AuditSource.USER);
      expect(Number(result.usedDays)).toBe(5);
    });

    it('floors usedDays at 0 when days exceeds usedDays', async () => {
      const bal = await seed({ totalDays: 20, usedDays: 2 });
      const result = await service.restore(bal.id, 10, 'actor', AuditSource.USER);
      expect(Number(result.usedDays)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // releasePending
  // ---------------------------------------------------------------------------

  describe('releasePending', () => {
    it('decrements pendingDays', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 4 });
      const result = await service.releasePending(bal.id, 4, 'actor', AuditSource.USER);
      expect(Number(result.pendingDays)).toBe(0);
    });

    it('floors pendingDays at 0', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 2 });
      const result = await service.releasePending(bal.id, 10, 'actor', AuditSource.USER);
      expect(Number(result.pendingDays)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // upsert
  // ---------------------------------------------------------------------------

  describe('upsert', () => {
    it('creates a new record when none exists', async () => {
      const result = await service.upsert(
        'emp-new-upsert', 'loc-a', LeaveType.SICK, 10, 0, AuditSource.HCM_BATCH,
      );
      expect(result.id).toBeDefined();
      expect(Number(result.totalDays)).toBe(10);
      expect(Number(result.usedDays)).toBe(0);
    });

    it('updates an existing record and does not create a duplicate', async () => {
      await service.upsert('emp-idem', 'loc-b', LeaveType.ANNUAL, 15, 3, AuditSource.HCM_BATCH);
      const second = await service.upsert(
        'emp-idem', 'loc-b', LeaveType.ANNUAL, 15, 3, AuditSource.HCM_BATCH,
      );
      const count = await balanceRepo.count({ where: { employeeId: 'emp-idem' } });
      expect(count).toBe(1);
      expect(Number(second.totalDays)).toBe(15);
      expect(Number(second.usedDays)).toBe(3);
    });

    it('resets pendingDays when totalDays changes by more than 0.1', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 3 });
      const result = await service.upsert(
        bal.employeeId, bal.locationId, bal.leaveType, 25, 0, AuditSource.HCM_BATCH,
      );
      expect(Number(result.pendingDays)).toBe(0);
    });

    it('preserves pendingDays when totalDays change is within 0.1', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 3 });
      const result = await service.upsert(
        bal.employeeId, bal.locationId, bal.leaveType, 20.05, 0, AuditSource.HCM_BATCH,
      );
      expect(Number(result.pendingDays)).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Audit logging — every mutation must produce an AuditLog entry
  // ---------------------------------------------------------------------------

  describe('audit logging', () => {
    it('deduct logs a DEDUCTED entry with negative deltaDays', async () => {
      const bal = await seed({ totalDays: 20 });
      await service.deduct(bal.id, 3, 'auditor', AuditSource.USER);
      const logs = await auditRepo.find({ where: { entityId: bal.id } });
      const entry = logs.find((l) => l.action === AuditAction.DEDUCTED);
      expect(entry).toBeDefined();
      expect(Number(entry.deltaDays)).toBe(-3);
    });

    it('confirmDeduction logs an UPDATED entry', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 5 });
      await service.confirmDeduction(bal.id, 5, 'auditor', AuditSource.USER);
      const logs = await auditRepo.find({ where: { entityId: bal.id } });
      expect(logs.some((l) => l.action === AuditAction.UPDATED)).toBe(true);
    });

    it('restore logs a RESTORED entry', async () => {
      const bal = await seed({ totalDays: 20, usedDays: 5 });
      await service.restore(bal.id, 2, 'auditor', AuditSource.USER);
      const logs = await auditRepo.find({ where: { entityId: bal.id } });
      expect(logs.some((l) => l.action === AuditAction.RESTORED)).toBe(true);
    });

    it('releasePending logs a RESTORED entry', async () => {
      const bal = await seed({ totalDays: 20, pendingDays: 4 });
      await service.releasePending(bal.id, 4, 'auditor', AuditSource.USER);
      const logs = await auditRepo.find({ where: { entityId: bal.id } });
      expect(logs.some((l) => l.action === AuditAction.RESTORED)).toBe(true);
    });

    it('upsert logs a SYNCED entry', async () => {
      const result = await service.upsert(
        'emp-audit-sync', 'loc-c', LeaveType.MATERNITY, 90, 0, AuditSource.HCM_BATCH,
      );
      const logs = await auditRepo.find({ where: { entityId: result.id } });
      expect(logs.some((l) => l.action === AuditAction.SYNCED)).toBe(true);
    });
  });
});

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Balance } from '../../src/entities/balance.entity';
import { AuditLog, AuditAction } from '../../src/entities/audit-log.entity';
import { TimeOffRequest } from '../../src/entities/time-off-request.entity';
import { AuditService } from '../../src/audit/audit.service';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmClientService } from '../../src/hcm-client/hcm-client.service';
import { RequestService } from '../../src/request/request.service';

jest.setTimeout(20000);

const mockHcmSvc = {
  postDeduction: jest.fn(),
  postReversal: jest.fn(),
  getBalance: jest.fn(),
};

describe('Concurrency — race conditions', () => {
  let moduleRef;
  let balanceRepo;
  let auditRepo;
  let requestRepo;
  let balanceService;
  let requestService;

  const LOC = 'loc_us_nyc';
  const ANNUAL = 'ANNUAL';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Balance, AuditLog, TimeOffRequest],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Balance, AuditLog, TimeOffRequest]),
      ],
      providers: [
        {
          provide: AuditService,
          useFactory: (repo) => new AuditService(repo),
          inject: [getRepositoryToken(AuditLog)],
        },
        {
          provide: BalanceService,
          useFactory: (repo, audit) => new BalanceService(repo, audit),
          inject: [getRepositoryToken(Balance), AuditService],
        },
        {
          provide: HcmClientService,
          useValue: mockHcmSvc,
        },
        {
          provide: RequestService,
          useFactory: (reqRepo, balSvc, hcmSvc, auditSvc) =>
            new RequestService(reqRepo, balSvc, hcmSvc, auditSvc, 5),
          inject: [
            getRepositoryToken(TimeOffRequest),
            BalanceService,
            HcmClientService,
            AuditService,
          ],
        },
      ],
    }).compile();

    balanceRepo = moduleRef.get(getRepositoryToken(Balance));
    auditRepo = moduleRef.get(getRepositoryToken(AuditLog));
    requestRepo = moduleRef.get(getRepositoryToken(TimeOffRequest));
    balanceService = moduleRef.get(BalanceService);
    requestService = moduleRef.get(RequestService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await requestRepo.clear();
    await auditRepo.clear();
    await balanceRepo.clear();
    jest.clearAllMocks();
    mockHcmSvc.postDeduction.mockResolvedValue({ hcmReferenceId: 'hcm-ok' });
    mockHcmSvc.postReversal.mockResolvedValue({ hcmReferenceId: 'hcm-rev-ok' });
  });

  async function seedBalance(employeeId, totalDays, usedDays = 0) {
    return balanceRepo.save(
      balanceRepo.create({
        employeeId,
        locationId: LOC,
        leaveType: ANNUAL,
        totalDays,
        usedDays,
        pendingDays: 0,
      }),
    );
  }

  function makeDto(employeeId, startDate, endDate, daysRequested) {
    return { employeeId, locationId: LOC, leaveType: ANNUAL, startDate, endDate, daysRequested };
  }

  // ---------------------------------------------------------------------------
  // Test 1: Two simultaneous requests, only one balance available
  // ---------------------------------------------------------------------------

  describe('two simultaneous requests, only one balance available', () => {
    it('allows exactly one request and rejects the other with 409 or 422', async () => {
      await seedBalance('emp_003', 5);

      const results = await Promise.allSettled([
        requestService.create(makeDto('emp_003', '2026-08-01', '2026-08-05', 5), 'actor'),
        requestService.create(makeDto('emp_003', '2026-09-01', '2026-09-05', 5), 'actor'),
      ]);

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.filter((r) => {
        if (r.status !== 'rejected') return false;
        const httpStatus = r.reason?.getStatus?.();
        return httpStatus === 409 || httpStatus === 422;
      }).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      const bal = await balanceRepo.findOne({
        where: { employeeId: 'emp_003', locationId: LOC, leaveType: ANNUAL },
      });
      expect(bal.availableDays).toBe(0);
      expect(bal.availableDays).toBeGreaterThanOrEqual(0);

      const deductedCount = await auditRepo.countBy({
        entityId: bal.id,
        action: AuditAction.DEDUCTED,
      });
      expect(deductedCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Ten simultaneous small requests, balance only fits two
  // ---------------------------------------------------------------------------

  describe('ten simultaneous small requests, balance only fits two', () => {
    it('allows exactly 2 requests and rejects the other 8 with 409 or 422', async () => {
      await seedBalance('emp_001', 15);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          requestService.create(
            makeDto(
              'emp_001',
              `2026-${String(i + 1).padStart(2, '0')}-01`,
              `2026-${String(i + 1).padStart(2, '0')}-06`,
              6,
            ),
            'actor',
          ),
        ),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.filter((r) => {
        if (r.status !== 'rejected') return false;
        const httpStatus = r.reason?.getStatus?.();
        return httpStatus === 409 || httpStatus === 422;
      }).length;

      expect(successCount).toBe(2);
      expect(failCount).toBe(8);

      const bal = await balanceRepo.findOne({
        where: { employeeId: 'emp_001', locationId: LOC, leaveType: ANNUAL },
      });
      expect(bal.availableDays).toBe(3);
      expect(bal.availableDays).toBeGreaterThanOrEqual(0);

      const deductedCount = await auditRepo.countBy({
        entityId: bal.id,
        action: AuditAction.DEDUCTED,
      });
      expect(deductedCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Concurrent batch sync and request submission
  // ---------------------------------------------------------------------------

  describe('concurrent batch sync and request submission', () => {
    it('does not throw DB integrity errors and leaves balance in a consistent state', async () => {
      await seedBalance('emp_sync', 15);

      const errors = [];

      const [syncResult, reqResult] = await Promise.allSettled([
        balanceService
          .upsert('emp_sync', LOC, ANNUAL, 15, 0, 'HCM_BATCH')
          .catch((e) => { errors.push(e); return null; }),
        requestService.create(makeDto('emp_sync', '2026-08-01', '2026-08-05', 3), 'actor'),
      ]);

      expect(errors).toHaveLength(0);

      // Both operations should have resolved without unexpected errors
      const reqStatus = reqResult.status;
      expect(reqStatus === 'fulfilled' || reqStatus === 'rejected').toBe(true);
      if (reqResult.status === 'rejected') {
        const httpStatus = reqResult.reason?.getStatus?.();
        expect(httpStatus === 409 || httpStatus === 422 || httpStatus === 503).toBe(true);
      }

      const bal = await balanceRepo.findOne({
        where: { employeeId: 'emp_sync', locationId: LOC, leaveType: ANNUAL },
      });
      expect(bal).toBeDefined();

      // Balance invariant: no negative available days
      expect(bal.availableDays).toBeGreaterThanOrEqual(0);
      expect(Number(bal.usedDays) + Number(bal.pendingDays)).toBeLessThanOrEqual(
        Number(bal.totalDays),
      );
    });
  });
});

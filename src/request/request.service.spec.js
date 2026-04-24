import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import {
  UnprocessableEntityException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TimeOffRequest, RequestStatus } from '../entities/time-off-request.entity';
import { AuditAction, AuditSource } from '../entities/audit-log.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { AuditService } from '../audit/audit.service';
import { RequestService } from './request.service';

// ---------------------------------------------------------------------------
// Shared mock objects — reset to sensible defaults before every test
// ---------------------------------------------------------------------------

const mockBalance = { id: 'bal-001', availableDays: 20, totalDays: 20, usedDays: 0, pendingDays: 0 };

const mockBalanceSvc = {
  getBalance: jest.fn(),
  deduct: jest.fn(),
  confirmDeduction: jest.fn(),
  restore: jest.fn(),
  releasePending: jest.fn(),
};

const mockHcmSvc = {
  postDeduction: jest.fn(),
  postReversal: jest.fn(),
};

const mockAuditSvc = {
  log: jest.fn(),
};

const MAX_RETRY = 3;

describe('RequestService', () => {
  let app;
  let service;
  let requestRepo;

  // -------------------------------------------------------------------------
  // DB setup — single in-memory SQLite shared across all tests
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [TimeOffRequest],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([TimeOffRequest]),
      ],
      providers: [
        { provide: BalanceService, useValue: mockBalanceSvc },
        { provide: HcmClientService, useValue: mockHcmSvc },
        { provide: AuditService, useValue: mockAuditSvc },
        {
          provide: RequestService,
          useFactory: (repo) =>
            new RequestService(repo, mockBalanceSvc, mockHcmSvc, mockAuditSvc, MAX_RETRY),
          inject: [getRepositoryToken(TimeOffRequest)],
        },
      ],
    }).compile();

    service = app.get(RequestService);
    requestRepo = app.get(getRepositoryToken(TimeOffRequest));
  });

  afterAll(() => app.close());

  // Reset mock state before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditSvc.log.mockResolvedValue({});
    mockBalanceSvc.getBalance.mockResolvedValue({ ...mockBalance });
    mockBalanceSvc.deduct.mockResolvedValue({});
    mockBalanceSvc.confirmDeduction.mockResolvedValue({});
    mockBalanceSvc.restore.mockResolvedValue({});
    mockBalanceSvc.releasePending.mockResolvedValue({});
    mockHcmSvc.postDeduction.mockResolvedValue({ hcmReferenceId: 'hcm-ok' });
    mockHcmSvc.postReversal.mockResolvedValue({ hcmReferenceId: 'hcm-rev-ok' });
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Generate a unique employee ID so tests don't cross-pollinate. */
  const uid = () => `emp-${Math.random().toString(36).slice(2, 9)}`;

  /** Build a valid create-DTO with unique employeeId by default. */
  const makeDto = (overrides = {}) => ({
    employeeId: uid(),
    locationId: 'loc-hq',
    leaveType: 'ANNUAL',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    daysRequested: 4,
    ...overrides,
  });

  /** Seed a TimeOffRequest directly into the DB, bypassing the service. */
  async function seedRequest(overrides = {}) {
    const r = requestRepo.create({
      employeeId: uid(),
      locationId: 'loc-hq',
      leaveType: 'ANNUAL',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      daysRequested: 4,
      status: RequestStatus.PENDING_APPROVAL,
      retryCount: 0,
      ...overrides,
    });
    return requestRepo.save(r);
  }

  // =========================================================================
  // create()
  // =========================================================================

  describe('create()', () => {
    it('happy path — returns PENDING_APPROVAL request with hcmReferenceId set', async () => {
      const dto = makeDto();
      const result = await service.create(dto, 'actor-001');

      expect(result.status).toBe(RequestStatus.PENDING_APPROVAL);
      expect(result.hcmReferenceId).toBe('hcm-ok');
      expect(mockBalanceSvc.deduct).toHaveBeenCalledWith(
        'bal-001', 4, 'actor-001', AuditSource.USER,
      );
      expect(mockHcmSvc.postDeduction).toHaveBeenCalledWith(
        dto.employeeId, dto.locationId, dto.leaveType, 4, expect.any(String),
      );
      expect(mockBalanceSvc.confirmDeduction).toHaveBeenCalledWith(
        'bal-001', 4, 'actor-001', AuditSource.USER,
      );
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CREATED }),
      );
    });

    it('throws 422 when balance is insufficient', async () => {
      mockBalanceSvc.getBalance.mockResolvedValue({ ...mockBalance, availableDays: 2 });
      await expect(service.create(makeDto({ daysRequested: 5 }), 'actor'))
        .rejects.toThrow(UnprocessableEntityException);
      expect(mockBalanceSvc.deduct).not.toHaveBeenCalled();
    });

    it('throws 409 when an overlapping PENDING_APPROVAL request exists', async () => {
      const empId = uid();
      // Seed an overlapping request for the same employee/location/leaveType
      await seedRequest({
        employeeId: empId,
        locationId: 'loc-hq',
        leaveType: 'ANNUAL',
        startDate: '2026-08-03',
        endDate: '2026-08-10',
        status: RequestStatus.PENDING_APPROVAL,
      });

      const dto = makeDto({ employeeId: empId, startDate: '2026-08-01', endDate: '2026-08-05' });
      await expect(service.create(dto, 'actor')).rejects.toThrow(ConflictException);
      expect(mockBalanceSvc.deduct).not.toHaveBeenCalled();
    });

    it('sets status=PENDING_HCM and returns without throwing when HCM is unavailable', async () => {
      mockHcmSvc.postDeduction.mockRejectedValue(new ServiceUnavailableException('HCM down'));
      const result = await service.create(makeDto(), 'actor');

      expect(result.status).toBe(RequestStatus.PENDING_HCM);
      expect(result.hcmReferenceId).toBeNull();
      expect(mockBalanceSvc.releasePending).not.toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.UPDATED }),
      );
    });

    it('sets status=FAILED, releases pending balance, and throws on HCM 422', async () => {
      mockHcmSvc.postDeduction.mockRejectedValue(
        new UnprocessableEntityException('invalid leave type'),
      );

      await expect(service.create(makeDto(), 'actor')).rejects.toThrow(UnprocessableEntityException);

      expect(mockBalanceSvc.releasePending).toHaveBeenCalledWith(
        'bal-001', 4, 'actor', AuditSource.USER,
      );
      // Verify the persisted status in DB
      const [failed] = await requestRepo.find({ where: { status: RequestStatus.FAILED } });
      expect(failed).toBeDefined();
    });
  });

  // =========================================================================
  // updateStatus()
  // =========================================================================

  describe('updateStatus()', () => {
    it('APPROVED — updates status and logs APPROVED action', async () => {
      const req = await seedRequest();
      const result = await service.updateStatus(req.id, { status: 'APPROVED' }, 'manager-1');
      // Flush fire-and-forget microtask so the test doesn't leak
      await new Promise((r) => setImmediate(r));

      expect(result.status).toBe(RequestStatus.APPROVED);
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPROVED }),
      );
    });

    it('REJECTED — releases balance (restore + releasePending) and posts HCM reversal', async () => {
      const req = await seedRequest();
      const result = await service.updateStatus(
        req.id,
        { status: 'REJECTED', rejectionReason: 'Not enough notice' },
        'manager-1',
      );

      expect(result.status).toBe(RequestStatus.REJECTED);
      expect(result.rejectionReason).toBe('Not enough notice');
      expect(mockBalanceSvc.restore).toHaveBeenCalledWith(
        'bal-001', 4, 'manager-1', AuditSource.USER,
      );
      expect(mockBalanceSvc.releasePending).toHaveBeenCalledWith(
        'bal-001', 4, 'manager-1', AuditSource.USER,
      );
      expect(mockHcmSvc.postReversal).toHaveBeenCalledWith(
        req.employeeId, req.locationId, req.leaveType, 4, req.id,
      );
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.REJECTED }),
      );
    });

    it('CANCELLED after APPROVED — restores balance and posts HCM reversal', async () => {
      const req = await seedRequest({ status: RequestStatus.APPROVED });
      const result = await service.updateStatus(req.id, { status: 'CANCELLED' }, 'emp-001');

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(mockBalanceSvc.restore).toHaveBeenCalledWith(
        'bal-001', 4, 'emp-001', AuditSource.USER,
      );
      expect(mockHcmSvc.postReversal).toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CANCELLED }),
      );
    });

    it('CANCELLED on non-APPROVED request — only sets status without touching balance', async () => {
      const req = await seedRequest({ status: RequestStatus.PENDING_APPROVAL });
      const result = await service.updateStatus(req.id, { status: 'CANCELLED' }, 'emp-001');

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(mockBalanceSvc.restore).not.toHaveBeenCalled();
      expect(mockHcmSvc.postReversal).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // retryPendingHcm()
  // =========================================================================

  describe('retryPendingHcm()', () => {
    it('promotes PENDING_HCM to APPROVED on successful HCM call', async () => {
      const req = await seedRequest({ status: RequestStatus.PENDING_HCM, retryCount: 0 });
      mockHcmSvc.postDeduction.mockResolvedValue({ hcmReferenceId: 'hcm-retry-ok' });

      await service.retryPendingHcm();

      const updated = await requestRepo.findOneBy({ id: req.id });
      expect(updated.status).toBe(RequestStatus.APPROVED);
      expect(updated.hcmReferenceId).toBe('hcm-retry-ok');
      expect(mockBalanceSvc.confirmDeduction).toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPROVED }),
      );
    });

    it('increments retryCount and marks FAILED once max retries are exceeded', async () => {
      // retryCount starts at MAX_RETRY - 1 so one more failure tips it over
      const req = await seedRequest({
        status: RequestStatus.PENDING_HCM,
        retryCount: MAX_RETRY - 1,
      });
      mockHcmSvc.postDeduction.mockRejectedValue(new ServiceUnavailableException('still down'));

      await service.retryPendingHcm();

      const updated = await requestRepo.findOneBy({ id: req.id });
      expect(updated.status).toBe(RequestStatus.FAILED);
      expect(updated.retryCount).toBe(MAX_RETRY);
      expect(mockBalanceSvc.releasePending).toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.UPDATED }),
      );
    });

    it('skips requests that have already reached the retry cap', async () => {
      const req = await seedRequest({
        status: RequestStatus.PENDING_HCM,
        retryCount: MAX_RETRY, // already at cap — should not be processed
      });

      await service.retryPendingHcm();

      const unchanged = await requestRepo.findOneBy({ id: req.id });
      expect(unchanged.status).toBe(RequestStatus.PENDING_HCM);
      // postDeduction might be called for other requests but not for this one
      const callArgs = mockHcmSvc.postDeduction.mock.calls;
      const calledForThis = callArgs.some((args) => args[4] === req.id);
      expect(calledForThis).toBe(false);
    });
  });
});

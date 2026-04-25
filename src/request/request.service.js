import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LessThan } from 'typeorm';
import { RequestStatus } from '../entities/time-off-request.entity';
import { AuditEntityType, AuditAction, AuditSource } from '../entities/audit-log.entity';

@Injectable()
export class RequestService {
  constructor(requestRepo, balanceService, hcmClientService, auditService, maxRetryAttempts) {
    this.requestRepo = requestRepo;
    this.balanceService = balanceService;
    this.hcmClientService = hcmClientService;
    this.auditService = auditService;
    this.maxRetryAttempts = Number(maxRetryAttempts ?? 5);
    this.logger = new Logger(RequestService.name);
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  async create(dto, actorId) {
    const { employeeId, locationId, leaveType, startDate, endDate, daysRequested } = dto;

    // 1. Validate available balance
    const balance = await this.balanceService.getBalance(employeeId, locationId, leaveType);
    if (balance.availableDays < daysRequested) {
      throw new UnprocessableEntityException(
        `Insufficient balance: ${balance.availableDays} days available, ${daysRequested} requested`,
      );
    }

    // 2. No overlapping active request
    const overlap = await this._findOverlap(employeeId, locationId, leaveType, startDate, endDate);
    if (overlap) {
      throw new ConflictException('An overlapping active time-off request already exists');
    }

    // 3. Hold pendingDays in balance
    await this.balanceService.deduct(balance.id, daysRequested, actorId, AuditSource.USER);

    // 4. Persist the request
    const request = this.requestRepo.create({ ...dto, status: RequestStatus.PENDING_APPROVAL });
    await this.requestRepo.save(request);
    await this._logRequest(request.id, AuditAction.CREATED, actorId, AuditSource.USER);

    this.logger.log(`Request ${request.id} created for employee ${employeeId}`);

    // 5. Notify HCM
    try {
      const { hcmReferenceId } = await this.hcmClientService.postDeduction(
        employeeId, locationId, leaveType, daysRequested, request.id,
      );
      request.hcmReferenceId = hcmReferenceId;
      await this.requestRepo.save(request);
      await this.balanceService.confirmDeduction(balance.id, daysRequested, actorId, AuditSource.USER);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        // Queue for background retry — do not throw
        this.logger.warn(`HCM unavailable for request ${request.id}, queued as PENDING_HCM`);
        request.status = RequestStatus.PENDING_HCM;
        await this.requestRepo.save(request);
        await this._logRequest(request.id, AuditAction.UPDATED, actorId, AuditSource.USER);
      } else {
        // Hard HCM error — release balance and surface failure
        this.logger.error(`HCM hard error for request ${request.id}: ${err.message}`);
        await this.balanceService.releasePending(balance.id, daysRequested, actorId, AuditSource.USER);
        request.status = RequestStatus.FAILED;
        await this.requestRepo.save(request);
        await this._logRequest(request.id, AuditAction.UPDATED, actorId, AuditSource.USER);
        throw new UnprocessableEntityException(err.message || 'HCM processing failed');
      }
    }

    return this.requestRepo.findOneBy({ id: request.id });
  }

  // ---------------------------------------------------------------------------
  // read
  // ---------------------------------------------------------------------------

  async findAll({ employeeId, locationId, leaveType, status, startDateFrom, startDateTo, page = 1, limit = 20 } = {}) {
    const qb = this.requestRepo.createQueryBuilder('r');
    if (employeeId) qb.andWhere('r.employeeId = :employeeId', { employeeId });
    if (locationId) qb.andWhere('r.locationId = :locationId', { locationId });
    if (leaveType) qb.andWhere('r.leaveType = :leaveType', { leaveType });
    if (status) qb.andWhere('r.status = :status', { status });
    if (startDateFrom) qb.andWhere('r.startDate >= :startDateFrom', { startDateFrom });
    if (startDateTo) qb.andWhere('r.startDate <= :startDateTo', { startDateTo });

    const [items, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id) {
    const request = await this.requestRepo.findOneBy({ id });
    if (!request) throw new NotFoundException(`Request ${id} not found`);
    return request;
  }

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  async updateStatus(id, dto, actorId) {
    const request = await this.findOne(id);
    const { status, rejectionReason, managerId } = dto;
    const source = AuditSource.USER;

    this.logger.log(`Updating request ${id} status to ${status}`);

    if (managerId) request.managerId = managerId;

    switch (status) {
      case 'APPROVED': {
        request.status = RequestStatus.APPROVED;
        await this.requestRepo.save(request);
        await this._logRequest(id, AuditAction.APPROVED, actorId, source);

        // Fire-and-forget — manager approval triggers HCM confirmation but never blocks
        this.hcmClientService
          .postDeduction(
            request.employeeId, request.locationId, request.leaveType,
            Number(request.daysRequested), id,
          )
          .catch(() => {});
        break;
      }

      case 'REJECTED': {
        const balance = await this.balanceService.getBalance(
          request.employeeId, request.locationId, request.leaveType,
        );
        const days = Number(request.daysRequested);
        // Both calls are idempotent — one of them will be a no-op depending on state
        await this.balanceService.restore(balance.id, days, actorId, source);
        await this.balanceService.releasePending(balance.id, days, actorId, source);
        await this.hcmClientService
          .postReversal(request.employeeId, request.locationId, request.leaveType, days, id)
          .catch(() => {});
        request.status = RequestStatus.REJECTED;
        if (rejectionReason) request.rejectionReason = rejectionReason;
        await this.requestRepo.save(request);
        await this._logRequest(id, AuditAction.REJECTED, actorId, source);
        break;
      }

      case 'CANCELLED': {
        if (request.status === RequestStatus.APPROVED) {
          const balance = await this.balanceService.getBalance(
            request.employeeId, request.locationId, request.leaveType,
          );
          const days = Number(request.daysRequested);
          await this.balanceService.restore(balance.id, days, actorId, source);
          try {
            await this.hcmClientService.postReversal(
              request.employeeId, request.locationId, request.leaveType, days, id,
            );
          } catch {
            // CANCELLATION_PENDING — proceed with local cancellation; retry externally
            await this._logRequest(id, AuditAction.UPDATED, actorId, source);
          }
        }
        request.status = RequestStatus.CANCELLED;
        await this.requestRepo.save(request);
        await this._logRequest(id, AuditAction.CANCELLED, actorId, source);
        break;
      }

      default:
        throw new UnprocessableEntityException(`Unsupported status transition to ${status}`);
    }

    return this.requestRepo.findOneBy({ id });
  }

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  async delete(id, actorId) {
    const request = await this.findOne(id);
    if (request.status !== RequestStatus.DRAFT) {
      throw new UnprocessableEntityException('Only DRAFT requests can be deleted');
    }
    await this.requestRepo.remove(request);
  }

  // ---------------------------------------------------------------------------
  // retryPendingHcm
  // ---------------------------------------------------------------------------

  async retryPendingHcm() {
    const toRetry = await this.requestRepo.find({
      where: {
        status: RequestStatus.PENDING_HCM,
        retryCount: LessThan(this.maxRetryAttempts),
      },
    });

    if (toRetry.length > 0) {
      this.logger.log(`Retrying ${toRetry.length} pending HCM request(s)`);
    }

    for (const request of toRetry) {
      const balance = await this.balanceService
        .getBalance(request.employeeId, request.locationId, request.leaveType)
        .catch(() => null);

      try {
        this.logger.warn(`Retrying HCM for request ${request.id} (attempt ${request.retryCount + 1}/${this.maxRetryAttempts})`);
        const { hcmReferenceId } = await this.hcmClientService.postDeduction(
          request.employeeId, request.locationId, request.leaveType,
          Number(request.daysRequested), request.id,
        );
        request.hcmReferenceId = hcmReferenceId;
        request.status = RequestStatus.APPROVED;
        await this.requestRepo.save(request);
        if (balance) {
          await this.balanceService.confirmDeduction(
            balance.id, Number(request.daysRequested), 'system', AuditSource.SCHEDULED_SYNC,
          );
        }
        await this._logRequest(request.id, AuditAction.APPROVED, 'system', AuditSource.SCHEDULED_SYNC);
      } catch {
        request.retryCount += 1;
        if (request.retryCount >= this.maxRetryAttempts) {
          this.logger.error(`HCM retry exhausted for request ${request.id}, marking FAILED`);
          request.status = RequestStatus.FAILED;
          await this.requestRepo.save(request);
          if (balance) {
            await this.balanceService.releasePending(
              balance.id, Number(request.daysRequested), 'system', AuditSource.SCHEDULED_SYNC,
            );
          }
          await this._logRequest(request.id, AuditAction.UPDATED, 'system', AuditSource.SCHEDULED_SYNC);
        } else {
          await this.requestRepo.save(request);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  _findOverlap(employeeId, locationId, leaveType, startDate, endDate) {
    return this.requestRepo
      .createQueryBuilder('r')
      .where('r.employeeId = :employeeId', { employeeId })
      .andWhere('r.locationId = :locationId', { locationId })
      .andWhere('r.leaveType = :leaveType', { leaveType })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [RequestStatus.APPROVED, RequestStatus.PENDING_APPROVAL],
      })
      .andWhere('r.startDate <= :endDate', { endDate })
      .andWhere('r.endDate >= :startDate', { startDate })
      .getOne();
  }

  _logRequest(entityId, action, actor, source) {
    return this.auditService.log({
      entityType: AuditEntityType.REQUEST,
      entityId,
      action,
      actor,
      source,
    });
  }
}

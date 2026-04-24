import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { AuditEntityType, AuditAction } from '../entities/audit-log.entity';

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BalanceService {
  constructor(balanceRepo, auditService) {
    this.balanceRepo = balanceRepo;
    this.auditService = auditService;
  }

  async getBalance(employeeId, locationId, leaveType) {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });
    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee=${employeeId} location=${locationId} leaveType=${leaveType}`,
      );
    }
    return balance;
  }

  async getBalancesForEmployee(employeeId) {
    return this.balanceRepo.find({ where: { employeeId } });
  }

  async deduct(balanceId, days, actor, source) {
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      const balance = await this.balanceRepo.findOneBy({ id: balanceId });
      if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

      if (balance.availableDays < days) {
        throw new UnprocessableEntityException(
          `Insufficient balance: ${balance.availableDays} available, ${days} requested`,
        );
      }

      balance.pendingDays = Number(balance.pendingDays) + days;

      try {
        const saved = await this.balanceRepo.save(balance);
        await this.auditService.log({
          entityType: AuditEntityType.BALANCE,
          entityId: balanceId,
          action: AuditAction.DEDUCTED,
          deltaDays: -days,
          actor,
          source,
        });
        return saved;
      } catch (err) {
        if (err instanceof OptimisticLockVersionMismatchError) {
          attempts++;
          await sleep(Math.floor(Math.random() * 50));
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException(`Balance ${balanceId} update conflict after ${MAX_RETRIES} retries`);
  }

  async confirmDeduction(balanceId, days, actor, source) {
    const balance = await this.balanceRepo.findOneBy({ id: balanceId });
    if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

    balance.pendingDays = Math.max(0, Number(balance.pendingDays) - days);
    balance.usedDays = Number(balance.usedDays) + days;

    const saved = await this.balanceRepo.save(balance);
    await this.auditService.log({
      entityType: AuditEntityType.BALANCE,
      entityId: balanceId,
      action: AuditAction.UPDATED,
      deltaDays: days,
      actor,
      source,
    });
    return saved;
  }

  async restore(balanceId, days, actor, source) {
    const balance = await this.balanceRepo.findOneBy({ id: balanceId });
    if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

    balance.usedDays = Math.max(0, Number(balance.usedDays) - days);

    const saved = await this.balanceRepo.save(balance);
    await this.auditService.log({
      entityType: AuditEntityType.BALANCE,
      entityId: balanceId,
      action: AuditAction.RESTORED,
      deltaDays: days,
      actor,
      source,
    });
    return saved;
  }

  async releasePending(balanceId, days, actor, source) {
    const balance = await this.balanceRepo.findOneBy({ id: balanceId });
    if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

    balance.pendingDays = Math.max(0, Number(balance.pendingDays) - days);

    const saved = await this.balanceRepo.save(balance);
    await this.auditService.log({
      entityType: AuditEntityType.BALANCE,
      entityId: balanceId,
      action: AuditAction.RESTORED,
      deltaDays: days,
      actor,
      source,
    });
    return saved;
  }

  async upsert(employeeId, locationId, leaveType, totalDays, usedDays, source) {
    let balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (!balance) {
      balance = this.balanceRepo.create({
        employeeId,
        locationId,
        leaveType,
        totalDays,
        usedDays,
        pendingDays: 0,
        lastSyncedAt: new Date(),
      });
    } else {
      const totalDaysChanged = Math.abs(Number(balance.totalDays) - totalDays) > 0.1;
      balance.totalDays = totalDays;
      balance.usedDays = usedDays;
      balance.lastSyncedAt = new Date();
      if (totalDaysChanged) {
        balance.pendingDays = 0;
      }
    }

    const saved = await this.balanceRepo.save(balance);
    await this.auditService.log({
      entityType: AuditEntityType.BALANCE,
      entityId: saved.id,
      action: AuditAction.SYNCED,
      actor: 'system',
      source,
    });
    return saved;
  }
}

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
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

  /**
   * Atomically checks available balance and moves `days` into pendingDays.
   * Uses an optimistic-lock loop: reads the current version, then issues an
   * UPDATE … WHERE id = ? AND version = ? so that a concurrent write causes
   * 0 affected rows, triggering a retry.
   */
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

      const newPendingDays = Number(balance.pendingDays) + days;
      const newVersion = Number(balance.version) + 1;

      const result = await this.balanceRepo
        .createQueryBuilder()
        .update()
        .set({ pendingDays: newPendingDays, version: newVersion })
        .where('id = :id AND version = :version', { id: balanceId, version: balance.version })
        .execute();

      if (result.affected > 0) {
        const saved = await this.balanceRepo.findOneBy({ id: balanceId });
        await this.auditService.log({
          entityType: AuditEntityType.BALANCE,
          entityId: balanceId,
          action: AuditAction.DEDUCTED,
          deltaDays: -days,
          actor,
          source,
        });
        return saved;
      }

      attempts++;
      await sleep(Math.floor(Math.random() * 50));
    }

    throw new ConflictException(`Balance ${balanceId} update conflict after ${MAX_RETRIES} retries`);
  }

  async confirmDeduction(balanceId, days, actor, source) {
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      const balance = await this.balanceRepo.findOneBy({ id: balanceId });
      if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

      const newPendingDays = Math.max(0, Number(balance.pendingDays) - days);
      const newUsedDays = Number(balance.usedDays) + days;
      const newVersion = Number(balance.version) + 1;

      const result = await this.balanceRepo
        .createQueryBuilder()
        .update()
        .set({ pendingDays: newPendingDays, usedDays: newUsedDays, version: newVersion })
        .where('id = :id AND version = :version', { id: balanceId, version: balance.version })
        .execute();

      if (result.affected > 0) {
        const saved = await this.balanceRepo.findOneBy({ id: balanceId });
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

      attempts++;
      await sleep(Math.floor(Math.random() * 50));
    }

    throw new ConflictException(`Balance ${balanceId} update conflict after ${MAX_RETRIES} retries`);
  }

  async restore(balanceId, days, actor, source) {
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      const balance = await this.balanceRepo.findOneBy({ id: balanceId });
      if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

      const newUsedDays = Math.max(0, Number(balance.usedDays) - days);
      const newVersion = Number(balance.version) + 1;

      const result = await this.balanceRepo
        .createQueryBuilder()
        .update()
        .set({ usedDays: newUsedDays, version: newVersion })
        .where('id = :id AND version = :version', { id: balanceId, version: balance.version })
        .execute();

      if (result.affected > 0) {
        const saved = await this.balanceRepo.findOneBy({ id: balanceId });
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

      attempts++;
      await sleep(Math.floor(Math.random() * 50));
    }

    throw new ConflictException(`Balance ${balanceId} update conflict after ${MAX_RETRIES} retries`);
  }

  async releasePending(balanceId, days, actor, source) {
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      const balance = await this.balanceRepo.findOneBy({ id: balanceId });
      if (!balance) throw new NotFoundException(`Balance ${balanceId} not found`);

      const newPendingDays = Math.max(0, Number(balance.pendingDays) - days);
      const newVersion = Number(balance.version) + 1;

      const result = await this.balanceRepo
        .createQueryBuilder()
        .update()
        .set({ pendingDays: newPendingDays, version: newVersion })
        .where('id = :id AND version = :version', { id: balanceId, version: balance.version })
        .execute();

      if (result.affected > 0) {
        const saved = await this.balanceRepo.findOneBy({ id: balanceId });
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

      attempts++;
      await sleep(Math.floor(Math.random() * 50));
    }

    throw new ConflictException(`Balance ${balanceId} update conflict after ${MAX_RETRIES} retries`);
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

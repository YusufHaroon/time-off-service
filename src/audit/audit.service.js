import { Injectable } from '@nestjs/common';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditService {
  /** @param {import('typeorm').Repository<AuditLog>} auditLogRepo */
  constructor(auditLogRepo) {
    this.auditLogRepo = auditLogRepo;
  }

  /**
   * Appends a single immutable audit entry. Never updates an existing record.
   *
   * @param {{ entityType, entityId, action, deltaDays?, actor, source, metadata? }} params
   * @returns {Promise<AuditLog>}
   */
  async log({ entityType, entityId, action, deltaDays, actor, source, metadata }) {
    const entry = this.auditLogRepo.create({
      entityType,
      entityId,
      action,
      deltaDays: deltaDays ?? null,
      actor,
      source,
      metadata: metadata !== undefined ? JSON.stringify(metadata) : null,
    });
    return this.auditLogRepo.save(entry);
  }
}

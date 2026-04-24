import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [
    {
      provide: AuditService,
      useFactory: (repo) => new AuditService(repo),
      inject: [getRepositoryToken(AuditLog)],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}

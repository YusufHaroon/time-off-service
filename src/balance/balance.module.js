import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Balance } from '../entities/balance.entity';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from './balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([Balance]), AuditModule],
  providers: [
    {
      provide: BalanceService,
      useFactory: (balanceRepo, auditService) => new BalanceService(balanceRepo, auditService),
      inject: [getRepositoryToken(Balance), AuditService],
    },
  ],
  exports: [BalanceService],
})
export class BalanceModule {}

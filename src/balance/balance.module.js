import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Balance } from '../entities/balance.entity';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from './balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([Balance]), AuditModule],
  providers: [
    {
      provide: BalanceService,
      useFactory: (balanceRepo, auditService, configService) =>
        new BalanceService(
          balanceRepo,
          auditService,
          Number(configService.get('BALANCE_LOCK_RETRIES') ?? 3),
        ),
      inject: [getRepositoryToken(Balance), AuditService, ConfigService],
    },
  ],
  exports: [BalanceService],
})
export class BalanceModule {}

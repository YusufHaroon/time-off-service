import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { TimeOffRequest } from '../entities/time-off-request.entity';
import { BalanceModule } from '../balance/balance.module';
import { BalanceService } from '../balance/balance.service';
import { HcmClientModule } from '../hcm-client/hcm-client.module';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { RequestService } from './request.service';
import { RequestController } from './request.controller';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalanceModule,
    HcmClientModule,
    AuditModule,
  ],
  controllers: [RequestController],
  providers: [
    {
      provide: RolesGuard,
      useFactory: (reflector) => new RolesGuard(reflector),
      inject: [Reflector],
    },
    {
      provide: RequestService,
      useFactory: (requestRepo, balanceSvc, hcmSvc, auditSvc, configSvc) =>
        new RequestService(
          requestRepo,
          balanceSvc,
          hcmSvc,
          auditSvc,
          Number(configSvc.get('HCM_RETRY_ATTEMPTS') ?? 5),
        ),
      inject: [
        getRepositoryToken(TimeOffRequest),
        BalanceService,
        HcmClientService,
        AuditService,
        ConfigService,
      ],
    },
  ],
  exports: [RequestService],
})
export class RequestModule {}

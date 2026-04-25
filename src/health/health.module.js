import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HealthService,
      useFactory: (dataSource) => new HealthService(dataSource),
      inject: [getDataSourceToken()],
    },
  ],
})
export class HealthModule {}

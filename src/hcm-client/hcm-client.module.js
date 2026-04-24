import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HcmClientService } from './hcm-client.service';

@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: HcmClientService,
      useFactory: (httpService, configService) =>
        new HcmClientService(
          httpService,
          configService.get('HCM_BASE_URL'),
          configService.get('HCM_API_KEY'),
          Number(configService.get('HCM_TIMEOUT_MS') ?? 3000),
        ),
      inject: [HttpService, ConfigService],
    },
  ],
  exports: [HcmClientService],
})
export class HcmClientModule {}

import { Controller, Dependencies, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
@Dependencies(HealthService)
export class HealthController {
  constructor(healthService) {
    this.healthService = healthService;
  }

  @Get()
  check() {
    return this.healthService.check();
  }
}

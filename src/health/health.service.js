import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HealthService {
  constructor(dataSource) {
    this.dataSource = dataSource;
    this.logger = new Logger(HealthService.name);
  }

  async check() {
    let dbStatus = 'connected';
    try {
      await this.dataSource.query('SELECT 1');
    } catch (err) {
      this.logger.error(`Database health check failed: ${err.message}`);
      dbStatus = 'disconnected';
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus,
    };
  }
}

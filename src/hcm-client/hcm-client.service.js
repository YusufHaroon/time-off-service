import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HcmClientService {
  /**
   * @param {import('@nestjs/axios').HttpService} httpService
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {number} timeoutMs
   */
  constructor(httpService, baseUrl, apiKey, timeoutMs) {
    this.httpService = httpService;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.timeoutMs = Number(timeoutMs);
    this.logger = new Logger(HcmClientService.name);
  }

  _headers() {
    return { 'X-HCM-API-Key': this.apiKey };
  }

  _handleError(err) {
    const status = err?.response?.status;
    this.logger.error(`HCM call failed (status=${status ?? 'network'}): ${err?.message}`);
    if (status === 404) {
      throw new NotFoundException('HCM: employee/location not found');
    }
    if (status === 422) {
      const msg = err.response?.data?.message ?? 'HCM: unprocessable request';
      throw new UnprocessableEntityException(msg);
    }
    // Covers 5xx responses and network/timeout errors (no err.response)
    throw new ServiceUnavailableException('HCM unavailable');
  }

  /**
   * GET /balance?employeeId=&locationId=&leaveType=
   * @returns {{ employeeId, locationId, leaveType, totalDays, usedDays }}
   */
  async getBalance(employeeId, locationId, leaveType) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/balance`, {
          params: { employeeId, locationId, leaveType },
          headers: this._headers(),
          timeout: this.timeoutMs,
        }),
      );
      return data;
    } catch (err) {
      this._handleError(err);
    }
  }

  /**
   * POST /balance — deduct days from an employee's balance.
   * @returns {{ hcmReferenceId: string }}
   */
  async postDeduction(employeeId, locationId, leaveType, days, requestId) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/balance`,
          { employeeId, locationId, leaveType, deductDays: days, referenceId: requestId },
          { headers: this._headers(), timeout: this.timeoutMs },
        ),
      );
      return data;
    } catch (err) {
      this._handleError(err);
    }
  }

  /**
   * POST /balance/reversal — restore days to an employee's balance.
   * @returns {{ hcmReferenceId: string }}
   */
  async postReversal(employeeId, locationId, leaveType, days, requestId) {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/balance/reversal`,
          { employeeId, locationId, leaveType, restoreDays: days, referenceId: requestId },
          { headers: this._headers(), timeout: this.timeoutMs },
        ),
      );
      return data;
    } catch (err) {
      this._handleError(err);
    }
  }
}

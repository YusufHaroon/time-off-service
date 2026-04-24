import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpModule, HttpService } from '@nestjs/axios';
import {
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import nock from 'nock';
import { HcmClientService } from './hcm-client.service';

const HCM_BASE = 'http://hcm-test.local';
const HCM_KEY = 'test-key';
const TIMEOUT_MS = 1000;

describe('HcmClientService', () => {
  let service;
  let app;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        {
          provide: HcmClientService,
          useFactory: (httpService) =>
            new HcmClientService(httpService, HCM_BASE, HCM_KEY, TIMEOUT_MS),
          inject: [HttpService],
        },
      ],
    }).compile();

    service = app.get(HcmClientService);
    nock.disableNetConnect();
  });

  afterAll(async () => {
    nock.enableNetConnect();
    await app.close();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // ---------------------------------------------------------------------------
  // getBalance
  // ---------------------------------------------------------------------------

  describe('getBalance', () => {
    it('returns parsed balance on 200', async () => {
      const payload = {
        employeeId: 'emp-1',
        locationId: 'loc-hq',
        leaveType: 'ANNUAL',
        totalDays: 20,
        usedDays: 5,
      };

      nock(HCM_BASE)
        .get('/balance')
        .query({ employeeId: 'emp-1', locationId: 'loc-hq', leaveType: 'ANNUAL' })
        .reply(200, payload);

      const result = await service.getBalance('emp-1', 'loc-hq', 'ANNUAL');
      expect(result).toEqual(payload);
    });

    it('sends the X-HCM-API-Key header', async () => {
      let capturedHeaders;

      nock(HCM_BASE)
        .get('/balance')
        .query(true)
        .reply(200, function () {
          capturedHeaders = this.req.headers;
          return { employeeId: 'emp-1', locationId: 'loc-hq', leaveType: 'ANNUAL', totalDays: 10, usedDays: 0 };
        });

      await service.getBalance('emp-1', 'loc-hq', 'ANNUAL');
      expect(capturedHeaders['x-hcm-api-key']).toBe(HCM_KEY);
    });

    it('throws NotFoundException on 404', async () => {
      nock(HCM_BASE).get('/balance').query(true).reply(404, { message: 'not found' });

      await expect(service.getBalance('emp-x', 'loc-hq', 'ANNUAL')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException with the HCM message on 404', async () => {
      nock(HCM_BASE).get('/balance').query(true).reply(404, {});

      const err = await service.getBalance('emp-x', 'loc-hq', 'ANNUAL').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('HCM: employee/location not found');
    });

    it('throws UnprocessableEntityException on 422', async () => {
      nock(HCM_BASE)
        .get('/balance')
        .query(true)
        .reply(422, { message: 'invalid leave type' });

      const err = await service.getBalance('emp-1', 'loc-hq', 'BAD').catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.message).toBe('invalid leave type');
    });

    it('throws ServiceUnavailableException on 500', async () => {
      nock(HCM_BASE).get('/balance').query(true).reply(500, { message: 'internal error' });

      await expect(service.getBalance('emp-1', 'loc-hq', 'ANNUAL')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on timeout / network error', async () => {
      nock(HCM_BASE)
        .get('/balance')
        .query(true)
        .replyWithError({ code: 'ECONNABORTED', message: 'connect ETIMEDOUT' });

      await expect(service.getBalance('emp-1', 'loc-hq', 'ANNUAL')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // postDeduction
  // ---------------------------------------------------------------------------

  describe('postDeduction', () => {
    it('sends correct body and returns hcmReferenceId', async () => {
      nock(HCM_BASE)
        .post('/balance', {
          employeeId: 'emp-1',
          locationId: 'loc-hq',
          leaveType: 'ANNUAL',
          deductDays: 5,
          referenceId: 'req-123',
        })
        .reply(200, { hcmReferenceId: 'hcm-ref-001' });

      const result = await service.postDeduction('emp-1', 'loc-hq', 'ANNUAL', 5, 'req-123');
      expect(result.hcmReferenceId).toBe('hcm-ref-001');
    });

    it('throws ServiceUnavailableException on 503', async () => {
      nock(HCM_BASE).post('/balance').reply(503, {});

      await expect(
        service.postDeduction('emp-1', 'loc-hq', 'ANNUAL', 5, 'req-x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ---------------------------------------------------------------------------
  // postReversal
  // ---------------------------------------------------------------------------

  describe('postReversal', () => {
    it('sends correct body and returns hcmReferenceId', async () => {
      nock(HCM_BASE)
        .post('/balance/reversal', {
          employeeId: 'emp-1',
          locationId: 'loc-hq',
          leaveType: 'ANNUAL',
          restoreDays: 3,
          referenceId: 'req-456',
        })
        .reply(200, { hcmReferenceId: 'hcm-ref-002' });

      const result = await service.postReversal('emp-1', 'loc-hq', 'ANNUAL', 3, 'req-456');
      expect(result.hcmReferenceId).toBe('hcm-ref-002');
    });

    it('throws NotFoundException on 404', async () => {
      nock(HCM_BASE).post('/balance/reversal').reply(404, {});

      await expect(
        service.postReversal('emp-x', 'loc-hq', 'ANNUAL', 3, 'req-x'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

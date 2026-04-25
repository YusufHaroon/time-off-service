import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryRequestsDto } from './query-requests.dto';

describe('QueryRequestsDto', () => {
  it('passes with no fields (all optional)', async () => {
    const dto = plainToInstance(QueryRequestsDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with all valid fields', async () => {
    const dto = plainToInstance(QueryRequestsDto, {
      employeeId: 'emp-1',
      locationId: 'loc-hq',
      leaveType: 'ANNUAL',
      status: 'APPROVED',
      startDateFrom: '2026-01-01',
      startDateTo: '2026-12-31',
      page: 2,
      limit: 50,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid leaveType enum value', async () => {
    const dto = plainToInstance(QueryRequestsDto, { leaveType: 'HOLIDAY' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'leaveType')).toBe(true);
  });

  it('rejects an invalid status enum value', async () => {
    const dto = plainToInstance(QueryRequestsDto, { status: 'UNKNOWN' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rejects limit > 100', async () => {
    const dto = plainToInstance(QueryRequestsDto, { limit: 200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects page < 1', async () => {
    const dto = plainToInstance(QueryRequestsDto, { page: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });
});

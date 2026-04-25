import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BatchSyncDto } from './batch-sync.dto';

const VALID_ITEM = {
  employeeId: 'emp-1',
  locationId: 'loc-hq',
  leaveType: 'ANNUAL',
  totalDays: 20,
  usedDays: 5,
};

const VALID = {
  source: 'HCM_API',
  asOf: '2026-04-25T00:00:00.000Z',
  balances: [VALID_ITEM],
};

describe('BatchSyncDto', () => {
  it('passes with a valid payload', async () => {
    const dto = plainToInstance(BatchSyncDto, VALID);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects missing source', async () => {
    const dto = plainToInstance(BatchSyncDto, { ...VALID, source: undefined });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'source')).toBe(true);
  });

  it('rejects missing asOf', async () => {
    const dto = plainToInstance(BatchSyncDto, { ...VALID, asOf: undefined });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'asOf')).toBe(true);
  });

  it('rejects empty balances array (ArrayMinSize)', async () => {
    const dto = plainToInstance(BatchSyncDto, { ...VALID, balances: [] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'balances')).toBe(true);
  });

  it('rejects invalid leaveType in a balance item (nested validation)', async () => {
    const dto = plainToInstance(BatchSyncDto, {
      ...VALID,
      balances: [{ ...VALID_ITEM, leaveType: 'HOLIDAY' }],
    });
    const errors = await validate(dto);
    const balanceError = errors.find((e) => e.property === 'balances');
    expect(balanceError).toBeDefined();
  });
});

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTimeOffRequestDto } from './create-time-off-request.dto';

const VALID_PAYLOAD = {
  employeeId: 'emp-001',
  locationId: 'loc-hq',
  leaveType: 'ANNUAL',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  daysRequested: 4,
};

describe('CreateTimeOffRequestDto', () => {
  it('passes with a valid payload', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, VALID_PAYLOAD);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with an optional notes field within 500 chars', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      ...VALID_PAYLOAD,
      notes: 'Family trip',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects missing required fields', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {});
    const errors = await validate(dto);
    const failed = errors.map((e) => e.property);
    expect(failed).toEqual(
      expect.arrayContaining([
        'employeeId',
        'locationId',
        'leaveType',
        'startDate',
        'endDate',
        'daysRequested',
      ]),
    );
  });

  it('rejects an invalid leaveType value', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      ...VALID_PAYLOAD,
      leaveType: 'VACATION',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'leaveType')).toBe(true);
  });

  it('rejects a non-positive daysRequested', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      ...VALID_PAYLOAD,
      daysRequested: -1,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'daysRequested')).toBe(true);
  });

  it('rejects notes exceeding 500 characters', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      ...VALID_PAYLOAD,
      notes: 'x'.repeat(501),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'notes')).toBe(true);
  });

  describe('endDate / startDate cross-field validation', () => {
    it('rejects endDate before startDate', async () => {
      const dto = plainToInstance(CreateTimeOffRequestDto, {
        ...VALID_PAYLOAD,
        startDate: '2026-06-05',
        endDate: '2026-06-01',
      });
      const errors = await validate(dto);
      const endDateErrors = errors.filter((e) => e.property === 'endDate');
      expect(endDateErrors.length).toBeGreaterThan(0);
      const messages = endDateErrors.flatMap((e) => Object.values(e.constraints || {}));
      expect(messages.some((m) => /startDate/i.test(m))).toBe(true);
    });

    it('passes when endDate equals startDate (same-day leave)', async () => {
      const dto = plainToInstance(CreateTimeOffRequestDto, {
        ...VALID_PAYLOAD,
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        daysRequested: 1,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('whitelist enforcement', () => {
    it('rejects unknown fields when forbidNonWhitelisted is enabled', async () => {
      const dto = plainToInstance(CreateTimeOffRequestDto, {
        ...VALID_PAYLOAD,
        unknownField: 'should-be-rejected',
      });
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.some((e) => e.property === 'unknownField')).toBe(true);
    });
  });
});

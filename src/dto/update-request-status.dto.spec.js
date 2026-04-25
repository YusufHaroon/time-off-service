import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateRequestStatusDto } from './update-request-status.dto';

describe('UpdateRequestStatusDto', () => {
  it('passes APPROVED without rejectionReason', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, { status: 'APPROVED' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes CANCELLED without rejectionReason', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, { status: 'CANCELLED' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes REJECTED with a rejectionReason', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, {
      status: 'REJECTED',
      rejectionReason: 'Insufficient notice',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when status is REJECTED but rejectionReason is absent', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, { status: 'REJECTED' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'rejectionReason')).toBe(true);
  });

  it('fails when status is an invalid value', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, { status: 'PENDING' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('passes with an optional managerId', async () => {
    const dto = plainToInstance(UpdateRequestStatusDto, {
      status: 'APPROVED',
      managerId: 'mgr-001',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

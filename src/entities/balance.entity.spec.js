import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { Balance, LeaveType } from './balance.entity';

describe('Balance entity', () => {
  describe('availableDays getter', () => {
    it('returns totalDays minus usedDays minus pendingDays', () => {
      const balance = new Balance();
      balance.totalDays = 20;
      balance.usedDays = 5;
      balance.pendingDays = 3;
      expect(balance.availableDays).toBe(12);
    });

    it('handles decimal values correctly', () => {
      const balance = new Balance();
      balance.totalDays = 15.5;
      balance.usedDays = 2.5;
      balance.pendingDays = 1;
      expect(balance.availableDays).toBe(12);
    });

    it('returns zero when all days are consumed', () => {
      const balance = new Balance();
      balance.totalDays = 10;
      balance.usedDays = 7;
      balance.pendingDays = 3;
      expect(balance.availableDays).toBe(0);
    });

    it('coerces string decimals from the DB driver', () => {
      const balance = new Balance();
      balance.totalDays = '20';
      balance.usedDays = '5';
      balance.pendingDays = '3';
      expect(balance.availableDays).toBe(12);
    });
  });

  describe('unique constraint', () => {
    it('defines a unique constraint on [employeeId, locationId, leaveType]', () => {
      const { uniques } = getMetadataArgsStorage();
      const balanceUniques = uniques.filter((u) => u.target === Balance);
      expect(balanceUniques).toHaveLength(1);
      expect(balanceUniques[0].columns).toEqual(['employeeId', 'locationId', 'leaveType']);
    });
  });

  describe('LeaveType enum', () => {
    it('contains all required values', () => {
      expect(Object.values(LeaveType)).toEqual(
        expect.arrayContaining(['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID']),
      );
    });
  });
});

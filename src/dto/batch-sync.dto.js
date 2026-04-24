import 'reflect-metadata';
import {
  IsString,
  IsEnum,
  IsDateString,
  IsNumber,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeaveType } from '../entities/balance.entity';

export class BalanceSyncItemDto {
  @IsString()
  employeeId;

  @IsString()
  locationId;

  @IsEnum(LeaveType)
  leaveType;

  @IsNumber()
  totalDays;

  @IsNumber()
  usedDays;
}

export class BatchSyncDto {
  @IsString()
  source;

  @IsDateString()
  asOf;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BalanceSyncItemDto)
  balances;
}

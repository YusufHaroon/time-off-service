import 'reflect-metadata';
import {
  IsString,
  IsEnum,
  IsDateString,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeaveType } from '../entities/balance.entity';
import { RequestStatus } from '../entities/time-off-request.entity';

export class QueryRequestsDto {
  @IsOptional()
  @IsString()
  employeeId;

  @IsOptional()
  @IsString()
  locationId;

  @IsOptional()
  @IsEnum(LeaveType)
  leaveType;

  @IsOptional()
  @IsEnum(RequestStatus)
  status;

  @IsOptional()
  @IsDateString()
  startDateFrom;

  @IsOptional()
  @IsDateString()
  startDateTo;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

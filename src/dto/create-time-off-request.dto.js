import 'reflect-metadata';
import {
  IsString,
  IsEnum,
  IsDateString,
  IsNumber,
  IsPositive,
  IsOptional,
  MaxLength,
  ValidatorConstraint,
  Validate,
} from 'class-validator';
import { LeaveType } from '../entities/balance.entity';

/** Ensures endDate is not before startDate. */
@ValidatorConstraint({ name: 'isEndDateAfterStartDate', async: false })
export class IsEndDateAfterStartDate {
  validate(endDate, args) {
    const { startDate } = args.object;
    if (!startDate || !endDate) return true;
    return new Date(endDate) >= new Date(startDate);
  }

  defaultMessage() {
    return 'endDate must be greater than or equal to startDate';
  }
}

export class CreateTimeOffRequestDto {
  @IsString()
  employeeId;

  @IsString()
  locationId;

  @IsEnum(LeaveType)
  leaveType;

  @IsDateString()
  startDate;

  @IsDateString()
  @Validate(IsEndDateAfterStartDate)
  endDate;

  @IsNumber()
  @IsPositive()
  daysRequested;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes;
}

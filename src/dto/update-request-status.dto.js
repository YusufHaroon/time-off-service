import 'reflect-metadata';
import { IsEnum, IsOptional, IsString, IsNotEmpty, ValidateIf } from 'class-validator';

/** Subset of RequestStatus values that a manager can transition to. */
export const UpdateableStatus = Object.freeze({
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

export class UpdateRequestStatusDto {
  @IsEnum(UpdateableStatus)
  status;

  @IsOptional()
  @IsString()
  managerId;

  /** Required when status is REJECTED. */
  @ValidateIf((o) => o.status === UpdateableStatus.REJECTED)
  @IsString()
  @IsNotEmpty()
  rejectionReason;
}

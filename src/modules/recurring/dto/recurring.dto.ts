import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { FREQUENCIES, Frequency, TX_TYPES, TxType } from 'src/common/types/domain.types';

export class CreateRecurringDto {
  @ApiProperty({ example: 'Netflix' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 649 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ enum: TX_TYPES, default: 'EXPENSE' })
  @IsOptional()
  @IsIn(TX_TYPES)
  type?: TxType;

  @ApiPropertyOptional({ enum: FREQUENCIES, default: 'MONTHLY' })
  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency: Frequency = 'MONTHLY';

  @ApiPropertyOptional({ description: 'Every N periods', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  interval?: number;

  @ApiPropertyOptional({ description: 'Day of month for MONTHLY rules (1-31)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ApiPropertyOptional({ description: '0=Sunday, for WEEKLY rules' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @ApiProperty({ example: '2026-01-05' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Post automatically without confirmation', default: true })
  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRecurringDto extends PartialType(CreateRecurringDto) {}

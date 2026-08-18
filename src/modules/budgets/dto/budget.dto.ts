import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BUDGET_PERIODS, BudgetPeriod } from 'src/common/types/domain.types';

export class CreateBudgetDto {
  @ApiProperty({ example: 'Food cap' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 12000, description: 'Limit in major units' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ enum: BUDGET_PERIODS, default: 'MONTHLY' })
  @IsOptional()
  @IsIn(BUDGET_PERIODS)
  period: BudgetPeriod = 'MONTHLY';

  @ApiPropertyOptional({ description: 'Omit for an all-category budget' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Unspent amount carries into the next period' })
  @IsOptional()
  @IsBoolean()
  rollover?: boolean;

  @ApiPropertyOptional({ example: 0.8, description: 'Notify when this fraction is consumed' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(1)
  alertThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Attach to an organization (business budget)' })
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {}

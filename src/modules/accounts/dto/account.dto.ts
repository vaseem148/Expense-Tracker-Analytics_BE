import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ACCOUNT_TYPES, AccountType } from 'src/common/types/domain.types';

export class CreateAccountDto {
  @ApiProperty({ example: 'HDFC Savings' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ enum: ACCOUNT_TYPES, default: 'BANK' })
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  type: AccountType = 'BANK';

  @ApiPropertyOptional({ description: 'Starting balance in major units', default: 0 })
  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: '#0ea5e9' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ example: 'credit-card' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: 'Credit limit in major units (CREDIT_CARD only)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {}

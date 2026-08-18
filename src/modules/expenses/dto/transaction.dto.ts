import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  TX_TYPES,
  TxType,
} from 'src/common/types/domain.types';

export class CreateTransactionDto {
  @ApiProperty({ example: 249.5, description: 'Always positive; direction comes from `type`' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'Swiggy order' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  description!: string;

  @ApiProperty({ example: '2026-08-18T12:30:00.000Z' })
  @IsISO8601()
  date!: string;

  @ApiProperty({ description: 'Source account id' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiPropertyOptional({ enum: TX_TYPES, default: 'EXPENSE' })
  @IsOptional()
  @IsIn(TX_TYPES)
  type: TxType = 'EXPENSE';

  @ApiPropertyOptional({ description: 'Destination account id (TRANSFER only)' })
  @IsOptional()
  @IsString()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'Swiggy' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, default: 'UPI' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ type: [String], description: 'Tag names; created on demand' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}

export class BulkDeleteDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

export class BulkCategorizeDto extends BulkDeleteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  categoryId!: string;
}

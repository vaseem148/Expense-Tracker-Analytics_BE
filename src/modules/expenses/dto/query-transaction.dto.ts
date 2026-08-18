import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  TX_TYPES,
  TxType,
} from 'src/common/types/domain.types';

const csv = ({ value }: { value: unknown }): string[] | undefined =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : (value as string[]);

export class QueryTransactionDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text search across description, merchant and notes' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: TX_TYPES })
  @IsOptional()
  @IsIn(TX_TYPES)
  type?: TxType;

  @ApiPropertyOptional({ description: 'Comma-separated category ids' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  categoryIds?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated account ids' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  accountIds?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated tag ids' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  tagIds?: string[];

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Minimum amount in major units' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum amount in major units' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  maxAmount?: number;

  @ApiPropertyOptional({ description: 'Only rows produced by a recurring rule' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({ description: 'Include soft-deleted rows' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({ description: 'Normalised merchant key' })
  @IsOptional()
  @IsString()
  merchantKey?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateVendorDto {
  @ApiProperty({ example: 'Amazon Web Services' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Cloud infrastructure' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @ApiProperty({ example: 'INV-2026-0042' })
  @IsString()
  @IsNotEmpty()
  number!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsISO8601()
  issueDate!: string;

  @ApiPropertyOptional({ description: 'Defaults to issueDate + vendor payment terms' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiProperty({ example: 100000, description: 'Pre-tax amount, major units' })
  @IsNumber()
  @Min(0)
  subtotal!: number;

  @ApiPropertyOptional({ example: 18000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'] })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}

export class PayInvoiceDto {
  @ApiProperty({ example: 59000, description: 'Payment amount in major units' })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ description: 'Account the payment leaves from' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;
}

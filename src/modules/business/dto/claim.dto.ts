import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateClaimDto {
  @ApiProperty({ example: 'Client visit - Bengaluru' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Transaction ids to attach' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  transactionIds?: string[];
}

export class UpdateClaimDto extends PartialType(CreateClaimDto) {}

export class DecideClaimDto {
  @ApiPropertyOptional({ description: 'Reason shown to the claimant' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReimburseClaimDto {
  @ApiPropertyOptional({ example: 'NEFT-8891234' })
  @IsOptional()
  @IsString()
  paymentRef?: string;
}

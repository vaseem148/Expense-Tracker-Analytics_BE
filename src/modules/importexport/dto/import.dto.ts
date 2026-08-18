import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ColumnMappingDto {
  @ApiProperty({ example: 'Date' })
  @IsString()
  date!: string;

  @ApiProperty({ example: 'Narration' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({ example: 'Withdrawal Amt.' })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ description: 'Separate debit column (bank statements)' })
  @IsOptional()
  @IsString()
  debit?: string;

  @ApiPropertyOptional({ description: 'Separate credit column (bank statements)' })
  @IsOptional()
  @IsString()
  credit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportCsvDto {
  @ApiProperty({ description: 'Raw CSV content including the header row' })
  @IsString()
  @IsNotEmpty()
  csv!: string;

  @ApiProperty({ description: 'Account the rows belong to' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty({ type: ColumnMappingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ColumnMappingDto)
  mapping!: ColumnMappingDto;

  @ApiPropertyOptional({ default: 'DD/MM/YYYY', enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'AUTO'] })
  @IsOptional()
  @IsIn(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'AUTO'])
  dateFormat?: string;

  @ApiPropertyOptional({ default: true, description: 'Skip rows already present (hash match)' })
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Auto-assign categories by keyword rules' })
  @IsOptional()
  @IsBoolean()
  autoCategorize?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Parse and report without writing' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Attach imported rows to this organization' })
  @IsOptional()
  @IsString()
  orgId?: string;
}

export class PreviewCsvDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  csv!: string;
}

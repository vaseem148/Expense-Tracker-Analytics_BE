import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsHexColor,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @ApiProperty({ example: 'Emergency fund' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 300000 })
  @IsNumber()
  @Min(1)
  target!: number;

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  saved?: number;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsISO8601()
  targetDate?: string;

  @ApiPropertyOptional({ example: '#10b981' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateGoalDto extends PartialType(CreateGoalDto) {}

export class ContributeDto {
  @ApiProperty({ example: 5000 })
  @IsNumber()
  amount!: number;
}

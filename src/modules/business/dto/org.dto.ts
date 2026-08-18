import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ORG_ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'EMPLOYEE'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export class CreateOrgDto {
  @ApiProperty({ example: 'Vaseem Technologies' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Vaseem Technologies Private Limited' })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ example: '33AABCU9603R1ZM', description: 'Indian GSTIN' })
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'GSTIN must be a valid 15-character identifier',
  })
  gstin?: string;

  @ApiPropertyOptional({ example: 'AABCU9603R' })
  @IsOptional()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN must be 10 characters (AAAAA9999A)' })
  pan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Chennai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Tamil Nadu' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: 4, description: 'Fiscal year start month (1-12)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @ApiPropertyOptional({ example: 2500000, description: 'Cash on hand, major units' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cashOnHand?: number;

  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsHexColor()
  logoColor?: string;
}

export class UpdateOrgDto extends PartialType(CreateOrgDto) {}

export class InviteMemberDto {
  @ApiProperty({ example: 'analyst@company.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ enum: ORG_ROLES, default: 'EMPLOYEE' })
  @IsOptional()
  @IsIn(ORG_ROLES)
  role?: OrgRole;

  @ApiPropertyOptional({ example: 'Financial Analyst' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Monthly personal spend cap, major units' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyLimit?: number;
}

export class UpdateMemberDto extends PartialType(InviteMemberDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'ENG' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code!: string;

  @ApiPropertyOptional({ example: 500000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBudget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  headUserId?: string;

  @ApiPropertyOptional({ example: '#0ea5e9' })
  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreateProjectDto {
  @ApiProperty({ example: 'Apollo Migration' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'APL-01' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ON_HOLD', 'COMPLETED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

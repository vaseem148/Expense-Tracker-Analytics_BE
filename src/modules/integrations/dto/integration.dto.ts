import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export const PROVIDERS = [
  'TALLY',
  'ZOHO_BOOKS',
  'QUICKBOOKS',
  'XERO',
  'BANK_FEED',
  'RAZORPAY',
  'GOOGLE_SHEETS',
  'SLACK',
  'WEBHOOK',
] as const;

export class ConnectIntegrationDto {
  @ApiProperty({ enum: PROVIDERS })
  @IsIn(PROVIDERS)
  provider!: string;

  @ApiPropertyOptional({ example: 'Head office Tally' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: 'Provider credentials; secrets are encrypted at rest' })
  @IsObject()
  credentials!: Record<string, string>;

  @ApiPropertyOptional({ description: 'Non-secret mapping configuration' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['SANDBOX', 'LIVE'], default: 'SANDBOX' })
  @IsOptional()
  @IsIn(['SANDBOX', 'LIVE'])
  mode?: 'SANDBOX' | 'LIVE';

  @ApiPropertyOptional({ description: 'Organization this integration belongs to' })
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional({ description: 'Seconds between automatic syncs', default: 3600 })
  @IsOptional()
  @IsInt()
  @Min(300)
  syncInterval?: number;
}

export class SyncDto {
  @ApiPropertyOptional({ description: 'Account to post pulled transactions into' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ enum: ['PULL', 'PUSH'], default: 'PULL' })
  @IsOptional()
  @IsIn(['PULL', 'PUSH'])
  direction?: 'PULL' | 'PUSH';
}

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://company.example.com/hooks/expense' })
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiProperty({ type: [String], example: ['transaction.created', 'claim.approved'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orgId?: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'ERP nightly job' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ type: [String], example: ['transactions:read', 'analytics:read'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional({ default: 1000 })
  @IsOptional()
  @IsInt()
  @Min(10)
  rateLimit?: number;
}

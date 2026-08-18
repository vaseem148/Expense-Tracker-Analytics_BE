import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { GRANULARITIES, Granularity } from '../types/domain.types';
import { defaultRange, parseDate } from '../utils/date';

export class DateRangeDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Inclusive start (ISO date)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Inclusive end (ISO date)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: GRANULARITIES, default: 'month' })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity: Granularity = 'month';

  /** Resolved window, defaulting to the trailing 12 months. */
  resolve(): { from: Date; to: Date } {
    const fallback = defaultRange();
    return {
      from: parseDate(this.from) ?? fallback.from,
      to: parseDate(this.to) ?? fallback.to,
    };
  }
}

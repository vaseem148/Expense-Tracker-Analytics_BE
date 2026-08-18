import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DateRangeDto } from 'src/common/dto/date-range.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { previousPeriod } from 'src/common/utils/date';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Every dashboard widget in a single response' })
  dashboard(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.analytics.dashboard(userId, range.resolve(), range.granularity);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Headline KPIs with period-over-period comparison' })
  overview(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.analytics.overview(userId, range.resolve());
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Bucketed spend/income with moving average and forecast' })
  @ApiQuery({ name: 'forecast', required: false, type: Boolean })
  timeseries(
    @CurrentUser('id') userId: string,
    @Query() range: DateRangeDto,
    @Query('forecast') withForecast?: string,
  ) {
    return this.analytics.timeseries(
      userId,
      range.resolve(),
      range.granularity,
      withForecast !== 'false',
    );
  }

  @Get('categories')
  @ApiQuery({ name: 'type', required: false, enum: ['EXPENSE', 'INCOME'] })
  @ApiOperation({ summary: 'Category breakdown with trend, volatility and Pareto analysis' })
  categories(
    @CurrentUser('id') userId: string,
    @Query() range: DateRangeDto,
    @Query('type') type?: 'EXPENSE' | 'INCOME',
  ) {
    return this.analytics.categories(userId, range.resolve(), range.granularity, type ?? 'EXPENSE');
  }

  @Get('merchants')
  @ApiOperation({ summary: 'Merchant leaderboard with detected purchase cadence' })
  merchants(
    @CurrentUser('id') userId: string,
    @Query() range: DateRangeDto,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.merchants(userId, range.resolve(), limit ? parseInt(limit, 10) : 20);
  }

  @Get('cashflow')
  @ApiOperation({ summary: 'Inflow vs outflow with cumulative position' })
  cashflow(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.analytics.cashflow(userId, range.resolve(), range.granularity);
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Weekday x hour spend grid plus a calendar series' })
  heatmap(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.analytics.heatmap(userId, range.resolve());
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Robust (MAD) outlier detection scored per category' })
  @ApiQuery({ name: 'threshold', required: false, type: Number })
  anomalies(
    @CurrentUser('id') userId: string,
    @Query() range: DateRangeDto,
    @Query('threshold') threshold?: string,
  ) {
    return this.analytics.anomalies(
      userId,
      range.resolve(),
      threshold ? parseFloat(threshold) : 3,
    );
  }

  @Get('recurring-candidates')
  @ApiOperation({ summary: 'Subscriptions mined from transaction periodicity' })
  recurring(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.analytics.recurringCandidates(userId, range.resolve());
  }

  @Get('budget-performance')
  @ApiOperation({ summary: 'Budget vs actual, with pace and projection' })
  budgets(@CurrentUser('id') userId: string) {
    return this.analytics.budgetPerformance(userId);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Compare the selected window against the preceding one' })
  compare(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    const current = range.resolve();
    return this.analytics.compare(
      userId,
      current,
      previousPeriod(current.from, current.to),
      range.granularity,
    );
  }
}

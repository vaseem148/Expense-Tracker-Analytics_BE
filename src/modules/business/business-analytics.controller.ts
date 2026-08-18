import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DateRangeDto } from 'src/common/dto/date-range.dto';
import { BusinessAnalyticsService } from './business-analytics.service';

@ApiTags('business')
@ApiBearerAuth()
@Controller('orgs/:orgId/analytics')
export class BusinessAnalyticsController {
  constructor(private readonly analytics: BusinessAnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Full business dashboard payload' })
  dashboard(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.dashboard(orgId, userId, range.resolve(), range.granularity);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Burn, runway, margin, cost per employee' })
  kpis(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.kpis(orgId, userId, range.resolve());
  }

  @Get('pnl')
  @ApiOperation({ summary: 'Profit and loss statement with prior-period comparison' })
  pnl(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.profitAndLoss(orgId, userId, range.resolve(), range.granularity);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Department budget vs actual and cost per head' })
  departments(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.departments(orgId, userId, range.resolve());
  }

  @Get('vendors')
  @ApiOperation({ summary: 'Vendor spend with concentration risk' })
  vendors(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.vendorAnalysis(orgId, userId, range.resolve());
  }

  @Get('tax')
  @ApiOperation({ summary: 'GST position by rate slab with input credit' })
  tax(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.taxSummary(orgId, userId, range.resolve());
  }

  @Get('claims')
  @ApiOperation({ summary: 'Reimbursement pipeline and approval latency' })
  claims(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.claimsAnalytics(orgId, userId, range.resolve());
  }

  @Get('cashflow')
  @ApiOperation({ summary: 'Cash projection including committed invoice outflow' })
  cashflow(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query() range: DateRangeDto,
  ) {
    return this.analytics.cashflowForecast(orgId, userId, range.resolve(), range.granularity);
  }
}

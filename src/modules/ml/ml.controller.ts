import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DateRangeDto } from 'src/common/dto/date-range.dto';
import { MlService } from './ml.service';

@ApiTags('ml')
@ApiBearerAuth()
@Controller('ml')
export class MlController {
  constructor(private readonly ml: MlService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the data-science service is reachable' })
  status() {
    return this.ml.status();
  }

  @Post('predict/category')
  @ApiOperation({ summary: 'Suggest a category for a description' })
  predict(
    @CurrentUser('id') userId: string,
    @Body() body: { description: string; amount?: number },
  ) {
    return this.ml.predictCategory(userId, body.description, body.amount);
  }

  @Post('train/category')
  @ApiOperation({ summary: 'Train a personal classifier on your labelled history' })
  train(@CurrentUser('id') userId: string) {
    return this.ml.trainCategoryModel(userId);
  }

  @Post('auto-categorize')
  @ApiOperation({ summary: 'Categorise everything still uncategorised (confident matches only)' })
  autoCategorize(@CurrentUser('id') userId: string, @Body() body: { limit?: number }) {
    return this.ml.autoCategorizeUncategorised(userId, body?.limit ?? 200);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Isolation Forest anomalies (MAD fallback)' })
  anomalies(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.ml.anomalies(userId, range.resolve());
  }

  @Get('clusters/merchants')
  @ApiOperation({ summary: 'KMeans merchant segments by frequency and ticket size' })
  clusters(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.ml.merchantClusters(userId, range.resolve());
  }

  @Get('risk/cashflow')
  @ApiOperation({ summary: 'Probability the next period ends cash-negative' })
  cashflowRisk(@CurrentUser('id') userId: string, @Query() range: DateRangeDto) {
    return this.ml.cashflowRisk(userId, range.resolve());
  }

  @Post('risk/vendors/:orgId')
  @ApiOperation({ summary: 'Score and persist vendor risk for an organization' })
  vendorRisk(@Param('orgId') orgId: string) {
    return this.ml.scoreVendors(orgId);
  }
}

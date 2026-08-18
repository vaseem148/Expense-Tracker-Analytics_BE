import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BusinessAnalyticsController } from './business-analytics.controller';
import { BusinessAnalyticsService } from './business-analytics.service';
import { BusinessController } from './business.controller';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { OrgAccessService } from './org-access.service';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [
    BusinessController,
    BusinessAnalyticsController,
    ClaimsController,
    InvoicesController,
  ],
  providers: [
    OrganizationsService,
    OrgAccessService,
    ClaimsService,
    InvoicesService,
    BusinessAnalyticsService,
  ],
  exports: [OrgAccessService, BusinessAnalyticsService],
})
export class BusinessModule {}

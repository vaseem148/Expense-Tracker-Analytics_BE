import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { RecurringModule } from '../recurring/recurring.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalyticsModule, AuthModule, RecurringModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}

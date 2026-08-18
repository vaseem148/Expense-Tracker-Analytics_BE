import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MlClient } from './ml.client';
import { MlController } from './ml.controller';
import { MlService } from './ml.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [MlController],
  providers: [MlService, MlClient],
  exports: [MlService, MlClient],
})
export class MlModule {}

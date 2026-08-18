import { Module } from '@nestjs/common';
import { ApiKeysService } from './apikeys.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, WebhooksService, ApiKeysService],
  exports: [IntegrationsService, WebhooksService, ApiKeysService],
})
export class IntegrationsModule {}

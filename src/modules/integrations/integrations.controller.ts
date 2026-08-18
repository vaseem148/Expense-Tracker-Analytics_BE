import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ApiKeysService } from './apikeys.service';
import {
  ConnectIntegrationDto,
  CreateApiKeyDto,
  CreateWebhookDto,
  SyncDto,
} from './dto/integration.dto';
import { IntegrationsService } from './integrations.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly webhooks: WebhooksService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Get('catalogue')
  @ApiOperation({ summary: 'Available connectors with their credential requirements' })
  catalogue() {
    return this.integrations.catalogue();
  }

  @Get()
  @ApiOperation({ summary: 'Configured integrations and their last sync run' })
  list(@CurrentUser('id') userId: string, @Query('orgId') orgId?: string) {
    return this.integrations.list(userId, orgId);
  }

  @Post('connect')
  @Audit('CREATE', 'Integration')
  @ApiOperation({ summary: 'Connect or reconfigure a provider (credentials encrypted at rest)' })
  connect(@CurrentUser('id') userId: string, @Body() dto: ConnectIntegrationDto) {
    return this.integrations.connect(userId, dto);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Verify credentials without syncing' })
  test(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.integrations.test(userId, id);
  }

  @Post(':id/sync')
  @Audit('IMPORT', 'Integration')
  @ApiOperation({ summary: 'Run a pull or push sync now' })
  sync(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: SyncDto) {
    return this.integrations.sync(userId, id, dto);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Sync history with per-run record counts' })
  runs(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.integrations.runs(userId, id);
  }

  @Post(':id/disconnect')
  @Audit('UPDATE', 'Integration')
  disconnect(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.integrations.disconnect(userId, id);
  }

  @Delete(':id')
  @Audit('DELETE', 'Integration')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.integrations.remove(userId, id);
  }

  // --- webhooks -------------------------------------------------------

  @Get('webhooks/list')
  webhookList(@CurrentUser('id') userId: string, @Query('orgId') orgId?: string) {
    return this.webhooks.list(userId, orgId);
  }

  @Post('webhooks')
  @Audit('CREATE', 'WebhookEndpoint')
  @ApiOperation({ summary: 'Register an endpoint; the signing secret is returned once' })
  createWebhook(@CurrentUser('id') userId: string, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(userId, dto);
  }

  @Post('webhooks/:id/ping')
  @ApiOperation({ summary: 'Send a signed test event' })
  pingWebhook(@Param('id') id: string) {
    return this.webhooks.ping(id);
  }

  @Get('webhooks/:id/deliveries')
  webhookDeliveries(@Param('id') id: string) {
    return this.webhooks.deliveries(id);
  }

  @Delete('webhooks/:id')
  @Audit('DELETE', 'WebhookEndpoint')
  removeWebhook(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.webhooks.remove(userId, id);
  }

  // --- api keys -------------------------------------------------------

  @Get('api-keys/list')
  apiKeyList(@CurrentUser('id') userId: string, @Query('orgId') orgId?: string) {
    return this.apiKeys.list(userId, orgId);
  }

  @Post('api-keys')
  @Audit('CREATE', 'ApiKey')
  @ApiOperation({ summary: 'Issue a machine-to-machine key (shown once)' })
  createApiKey(@CurrentUser('id') userId: string, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(userId, dto);
  }

  @Delete('api-keys/:id')
  @Audit('DELETE', 'ApiKey')
  revokeApiKey(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.apiKeys.revoke(userId, id);
  }
}

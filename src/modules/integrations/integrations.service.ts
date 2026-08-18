import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { normaliseMerchant, transactionHash } from 'src/common/utils/merchant';
import { toMinor } from 'src/common/utils/money';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.util';
import { catalogue, getConnector } from './connectors/registry';
import { ConnectorContext } from './connectors/connector.interface';
import { ConnectIntegrationDto, SyncDto } from './dto/integration.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  private get key(): string {
    return process.env.ENCRYPTION_KEY ?? 'dev-encryption-key-change-me';
  }

  catalogue() {
    return catalogue();
  }

  async list(userId: string, orgId?: string) {
    const rows = await this.prisma.integration.findMany({
      where: orgId ? { orgId } : { userId, orgId: null },
      include: { syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((i) => {
      const connector = getConnector(i.provider);
      const last = i.syncRuns[0];
      return {
        id: i.id,
        provider: i.provider,
        displayName: i.displayName,
        category: catalogue().find((c) => c.provider === i.provider)?.category ?? 'Other',
        capabilities: connector?.capabilities ?? [],
        status: i.status,
        mode: i.mode,
        config: i.config ? (JSON.parse(i.config) as Record<string, unknown>) : {},
        // Credentials never leave the server in readable form.
        credentialPreview: i.credentials ? maskSecret(i.credentials) : null,
        lastSyncAt: i.lastSyncAt,
        lastError: i.lastError,
        syncInterval: i.syncInterval,
        isActive: i.isActive,
        lastRun: last
          ? {
              status: last.status,
              direction: last.direction,
              recordsRead: last.recordsRead,
              recordsWritten: last.recordsWritten,
              recordsSkipped: last.recordsSkipped,
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
            }
          : null,
      };
    });
  }

  async connect(userId: string, dto: ConnectIntegrationDto) {
    const connector = getConnector(dto.provider);
    if (!connector) throw new BadRequestException(`Unknown provider ${dto.provider}`);

    const missing = connector.requiredCredentials
      .filter((c) => !dto.credentials[c.key])
      .map((c) => c.label);
    if (missing.length) {
      throw new BadRequestException(`Missing credentials: ${missing.join(', ')}`);
    }

    const ctx: ConnectorContext = {
      orgId: dto.orgId ?? null,
      userId,
      config: dto.config ?? {},
      credentials: dto.credentials,
      mode: dto.mode ?? 'SANDBOX',
    };
    const test = await connector.test(ctx);

    const data = {
      provider: dto.provider,
      displayName: dto.displayName ?? connector.displayName,
      status: test.ok ? 'CONNECTED' : 'ERROR',
      mode: dto.mode ?? 'SANDBOX',
      credentials: encryptSecret(JSON.stringify(dto.credentials), this.key),
      config: JSON.stringify(dto.config ?? {}),
      scopes: JSON.stringify(connector.capabilities),
      lastError: test.ok ? null : test.message,
      syncInterval: dto.syncInterval ?? 3600,
      userId: dto.orgId ? null : userId,
      orgId: dto.orgId ?? null,
    };

    const existing = dto.orgId
      ? await this.prisma.integration.findFirst({ where: { orgId: dto.orgId, provider: dto.provider } })
      : await this.prisma.integration.findFirst({
          where: { userId, orgId: null, provider: dto.provider },
        });

    const saved = existing
      ? await this.prisma.integration.update({ where: { id: existing.id }, data })
      : await this.prisma.integration.create({ data });

    return { id: saved.id, status: saved.status, test };
  }

  async test(userId: string, id: string) {
    const { integration, ctx, connector } = await this.context(userId, id);
    const result = await connector.test(ctx);
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { status: result.ok ? 'CONNECTED' : 'ERROR', lastError: result.ok ? null : result.message },
    });
    return result;
  }

  async disconnect(userId: string, id: string) {
    const integration = await this.owned(userId, id);
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'DISCONNECTED', isActive: false, credentials: null },
    });
    return { id, disconnected: true as const };
  }

  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.prisma.integration.delete({ where: { id } });
    return { id, deleted: true as const };
  }

  async runs(userId: string, id: string) {
    await this.owned(userId, id);
    const runs = await this.prisma.syncRun.findMany({
      where: { integrationId: id },
      orderBy: { startedAt: 'desc' },
      take: 25,
    });
    return runs.map((r) => ({ ...r, log: r.log ? (JSON.parse(r.log) as string[]) : [] }));
  }

  /**
   * Pulls from the external system and writes rows into the ledger.
   * De-duplication uses the same transaction hash as CSV import, so a row that
   * arrives via both a bank feed and a statement upload lands only once.
   */
  async sync(userId: string, id: string, dto: SyncDto) {
    const { integration, ctx, connector } = await this.context(userId, id);
    const direction = dto.direction ?? 'PULL';

    if (direction === 'PULL' && !connector.pull) {
      throw new BadRequestException(`${connector.displayName} does not support pulling`);
    }

    const run = await this.prisma.syncRun.create({
      data: { integrationId: id, direction, status: 'RUNNING' },
    });
    await this.prisma.integration.update({ where: { id }, data: { status: 'SYNCING' } });
    this.events.emit('sync.progress', { userId, provider: integration.provider, status: 'started' });

    const log: string[] = [];
    let read = 0;
    let written = 0;
    let skipped = 0;
    let errors = 0;

    try {
      if (direction === 'PULL') {
        const result = await this.runPull(userId, integration, ctx, connector, dto, log);
        read = result.read;
        written = result.written;
        skipped = result.skipped;
      } else {
        const result = await this.runPush(userId, integration, ctx, connector, log);
        read = result.read;
        written = result.written;
        errors = result.errors;
      }

      log.push(`Wrote ${written}, skipped ${skipped} duplicate(s)`);
      await this.finishRun(run.id, id, errors ? 'PARTIAL' : 'SUCCESS', {
        read,
        written,
        skipped,
        errors,
        log,
      });
      this.cache.invalidate(`analytics:${userId}`);
      this.events.emit('sync.progress', {
        userId,
        provider: integration.provider,
        status: 'completed',
      });
      return { runId: run.id, status: 'SUCCESS', read, written, skipped, log };
    } catch (err) {
      const message = (err as Error).message;
      log.push(`Failed: ${message}`);
      await this.finishRun(run.id, id, 'FAILED', { read, written, skipped, errors: 1, log }, message);
      this.logger.error(`sync ${id} failed: ${message}`);
      throw err;
    }
  }

  private async runPull(
    userId: string,
    integration: { id: string; orgId: string | null },
    ctx: ConnectorContext,
    connector: { pull?: (c: ConnectorContext) => Promise<{ transactions: any[]; cursor?: string | null }>; displayName: string },
    dto: SyncDto,
    log: string[],
  ) {
    const accountId =
      dto.accountId ??
      (await this.prisma.account.findFirst({ where: { userId }, select: { id: true } }))?.id;
    if (!accountId) throw new BadRequestException('No account available to receive transactions');

    const result = await connector.pull!(ctx);
    let written = 0;
    let skipped = 0;
    log.push(`Fetched ${result.transactions.length} record(s) from ${connector.displayName}`);

    for (const t of result.transactions) {
      const date = new Date(t.date);
      const amountMinor = toMinor(t.amount);
      const hash = transactionHash({
        accountId,
        date,
        amountMinor,
        description: t.description,
        type: t.type,
      });

      const dupe = await this.prisma.transaction.findFirst({
        where: { userId, externalHash: hash },
        select: { id: true },
      });
      if (dupe) {
        skipped++;
        continue;
      }

      const vendorId = integration.orgId
        ? await this.resolveVendor(integration.orgId, t.vendorName ?? t.merchant)
        : null;

      await this.prisma.transaction.create({
        data: {
          userId,
          accountId,
          orgId: integration.orgId,
          scope: integration.orgId ? 'BUSINESS' : 'PERSONAL',
          vendorId,
          type: t.type,
          amountMinor,
          description: t.description,
          merchant: t.merchant ?? null,
          merchantKey: normaliseMerchant(t.merchant ?? t.description),
          date,
          taxAmountMinor: toMinor(t.taxAmount ?? 0),
          taxRateBps: Math.round((t.taxRatePct ?? 0) * 100),
          externalHash: hash,
          notes: t.reference ? `Ref ${t.reference}` : null,
          importBatchId: integration.id,
        },
      });
      written++;
    }

    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { syncCursor: result.cursor ?? null },
    });

    return { read: result.transactions.length, written, skipped };
  }

  private async runPush(
    userId: string,
    integration: { orgId: string | null },
    ctx: ConnectorContext,
    connector: { push?: (c: ConnectorContext, t: any[]) => Promise<{ pushed: number; failed: number; messages: string[] }> },
    log: string[],
  ) {
    const pending = await this.prisma.transaction.findMany({
      where: {
        userId,
        isDeleted: false,
        ...(integration.orgId ? { orgId: integration.orgId } : {}),
        date: { gte: new Date(Date.now() - 30 * 864e5) },
      },
      take: 200,
      include: { vendor: { select: { name: true } } },
    });

    const result = connector.push
      ? await connector.push(
          ctx,
          pending.map((t) => ({
            externalId: t.id,
            date: t.date.toISOString(),
            amount: t.amountMinor / 100,
            currency: t.currency,
            description: t.description,
            merchant: t.merchant ?? undefined,
            vendorName: t.vendor?.name,
            type: t.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
            taxAmount: t.taxAmountMinor / 100,
          })),
        )
      : { pushed: 0, failed: pending.length, messages: ['Push not supported by this connector'] };

    log.push(...result.messages);
    return { read: pending.length, written: result.pushed, errors: result.failed };
  }

  /** Matches a vendor by normalised name, creating it when it is new. */
  private async resolveVendor(orgId: string, name?: string | null): Promise<string | null> {
    if (!name) return null;
    const normKey = normaliseMerchant(name) ?? name.toLowerCase();
    const existing = await this.prisma.vendor.findFirst({ where: { orgId, normKey } });
    if (existing) return existing.id;
    const created = await this.prisma.vendor.create({
      data: { orgId, name: name.trim(), normKey, category: 'Auto-created by sync' },
    });
    return created.id;
  }

  private async finishRun(
    runId: string,
    integrationId: string,
    status: string,
    counts: { read: number; written: number; skipped: number; errors: number; log: string[] },
    error?: string,
  ) {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        status,
        recordsRead: counts.read,
        recordsWritten: counts.written,
        recordsSkipped: counts.skipped,
        errorCount: counts.errors,
        log: JSON.stringify(counts.log),
        finishedAt: new Date(),
      },
    });
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: status === 'FAILED' ? 'ERROR' : 'CONNECTED',
        lastSyncAt: new Date(),
        lastError: error ?? null,
      },
    });
  }

  private async owned(userId: string, id: string) {
    const integration = await this.prisma.integration.findUnique({ where: { id } });
    if (!integration) throw new NotFoundException('Integration not found');
    if (integration.userId && integration.userId !== userId) {
      throw new NotFoundException('Integration not found');
    }
    if (integration.orgId) {
      const member = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: integration.orgId, userId } },
      });
      if (!member || !['OWNER', 'ADMIN', 'FINANCE'].includes(member.role)) {
        throw new NotFoundException('Integration not found');
      }
    }
    return integration;
  }

  private async context(userId: string, id: string) {
    const integration = await this.owned(userId, id);
    const connector = getConnector(integration.provider);
    if (!connector) throw new BadRequestException('Connector no longer available');
    if (!integration.credentials) throw new BadRequestException('Integration is disconnected');

    const ctx: ConnectorContext = {
      orgId: integration.orgId,
      userId,
      config: integration.config ? (JSON.parse(integration.config) as Record<string, unknown>) : {},
      credentials: JSON.parse(decryptSecret(integration.credentials, this.key)) as Record<
        string,
        string
      >,
      mode: integration.mode as 'SANDBOX' | 'LIVE',
      cursor: integration.syncCursor,
    };
    return { integration, ctx, connector };
  }
}

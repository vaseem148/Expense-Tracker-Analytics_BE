import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateWebhookDto } from './dto/integration.dto';

const MAX_ATTEMPTS = 5;

/**
 * Outbound webhooks with HMAC-SHA256 signing and exponential backoff.
 * The signature format mirrors the industry norm (t=...,v1=...) so the
 * receiving team can verify it with code they already have.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, orgId?: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: orgId ? { orgId } : { userId, orgId: null },
      include: {
        deliveries: { orderBy: { createdAt: 'desc' }, take: 5 },
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((w) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse(w.events) as string[],
      isActive: w.isActive,
      failureCount: w.failureCount,
      lastStatus: w.lastStatus,
      createdAt: w.createdAt,
      secretHint: `whsec_${w.secret.slice(6, 10)}...`,
      totalDeliveries: w._count.deliveries,
      recentDeliveries: w.deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        statusCode: d.statusCode,
        attempt: d.attempt,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
    }));
  }

  async create(userId: string, dto: CreateWebhookDto) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        userId: dto.orgId ? null : userId,
        orgId: dto.orgId ?? null,
        url: dto.url,
        secret,
        events: JSON.stringify(dto.events),
      },
    });
    // Returned exactly once - afterwards it is only ever used for signing.
    return { id: endpoint.id, url: endpoint.url, events: dto.events, secret };
  }

  async remove(userId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!endpoint) throw new NotFoundException('Webhook not found');
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { id, deleted: true as const };
  }

  async deliveries(id: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Fires a test payload so the receiving team can verify their handler. */
  async ping(id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!endpoint) throw new NotFoundException('Webhook not found');
    return this.deliver(endpoint, 'ping', { message: 'Expense Analytics test event' });
  }

  sign(payload: string, secret: string, timestamp: number): string {
    return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  }

  /** Constant-time verification helper, mirrored in the integration docs. */
  verify(payload: string, secret: string, timestamp: number, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload, secret, timestamp));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async deliver(
    endpoint: { id: string; url: string; secret: string },
    event: string,
    data: unknown,
    attempt = 1,
  ) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ event, data, timestamp });
    const signature = this.sign(payload, endpoint.secret, timestamp);

    const delivery = await this.prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, event, payload, attempt },
    });

    try {
      const res = await axios.post(endpoint.url, payload, {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'X-Expense-Signature': `t=${timestamp},v1=${signature}`,
          'X-Expense-Event': event,
          'X-Expense-Delivery': delivery.id,
        },
        validateStatus: () => true,
      });

      const ok = res.status >= 200 && res.status < 300;
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          statusCode: res.status,
          responseBody: String(res.data).slice(0, 500),
          deliveredAt: ok ? new Date() : null,
          // Backoff schedule: 1m, 2m, 4m, 8m, 16m.
          nextRetryAt:
            ok || attempt >= MAX_ATTEMPTS
              ? null
              : new Date(Date.now() + 60_000 * 2 ** (attempt - 1)),
        },
      });
      await this.prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastStatus: res.status,
          failureCount: ok ? 0 : { increment: 1 },
          // A permanently broken endpoint is disabled instead of retried forever.
          ...(!ok && attempt >= MAX_ATTEMPTS ? { isActive: false } : {}),
        },
      });
      return { delivered: ok, statusCode: res.status, deliveryId: delivery.id };
    } catch (err) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          responseBody: (err as Error).message.slice(0, 500),
          nextRetryAt:
            attempt >= MAX_ATTEMPTS ? null : new Date(Date.now() + 60_000 * 2 ** (attempt - 1)),
        },
      });
      return { delivered: false, statusCode: null, deliveryId: delivery.id };
    }
  }

  /** Fan-out helper used by the event listeners below. */
  private async dispatch(scope: { userId?: string; orgId?: string }, event: string, data: unknown) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        isActive: true,
        ...(scope.orgId ? { orgId: scope.orgId } : { userId: scope.userId, orgId: null }),
      },
    });
    for (const endpoint of endpoints) {
      const events = JSON.parse(endpoint.events) as string[];
      if (!events.includes(event) && !events.includes('*')) continue;
      void this.deliver(endpoint, event, data).catch(() => undefined);
    }
  }

  @OnEvent('transaction.created')
  onTransactionCreated(p: { userId: string; transaction: unknown }) {
    void this.dispatch({ userId: p.userId }, 'transaction.created', p.transaction);
  }

  @OnEvent('budget.exceeded')
  onBudgetExceeded(p: { userId: string; name: string; consumedPct: number }) {
    void this.dispatch({ userId: p.userId }, 'budget.exceeded', p);
  }

  @OnEvent('claim.approved')
  onClaimApproved(p: { orgId: string; claimId: string }) {
    void this.dispatch({ orgId: p.orgId }, 'claim.approved', p);
  }

  @OnEvent('claim.submitted')
  onClaimSubmitted(p: { orgId: string; claimId: string }) {
    void this.dispatch({ orgId: p.orgId }, 'claim.submitted', p);
  }

  /** Retry sweep for deliveries whose backoff window has elapsed. */
  async retryPending(): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { nextRetryAt: { lte: new Date() }, deliveredAt: null },
      include: { endpoint: true },
      take: 50,
    });
    let retried = 0;
    for (const d of due) {
      if (!d.endpoint.isActive) continue;
      const body = JSON.parse(d.payload) as { data: unknown };
      await this.deliver(d.endpoint, d.event, body.data, d.attempt + 1);
      retried++;
    }
    return retried;
  }
}

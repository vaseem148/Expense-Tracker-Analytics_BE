import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
import { RecurringService } from '../recurring/recurring.service';

/**
 * All background work lives here so the schedule is readable in one place.
 * Each job is defensive: a failure is logged and swallowed rather than
 * crashing the process and taking the API down with it.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recurring: RecurringService,
    private readonly analytics: AnalyticsService,
    private readonly auth: AuthService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  /** Materialise due recurring charges every hour. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'recurring' })
  async postRecurring(): Promise<void> {
    try {
      const res = await this.recurring.processDue();
      if (res.posted) this.logger.log(`recurring: posted ${res.posted}, skipped ${res.skipped}`);
    } catch (err) {
      this.logger.error(`recurring job failed: ${(err as Error).message}`);
    }
  }

  /** Budget threshold sweep - notifies once per crossing, twice a day. */
  @Cron('0 9,21 * * *', { name: 'budget-alerts' })
  async budgetAlerts(): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true, budgets: { some: { isActive: true } } },
        select: { id: true },
      });

      for (const user of users) {
        const perf = await this.analytics.budgetPerformance(user.id);
        for (const b of perf.items) {
          if (b.consumedPct < b.alertThresholdPct) continue;
          const already = await this.prisma.notification.findFirst({
            where: {
              userId: user.id,
              type: 'BUDGET_ALERT',
              title: { contains: b.name },
              createdAt: { gte: new Date(Date.now() - 20 * 3600_000) },
            },
            select: { id: true },
          });
          if (already) continue;
          this.events.emit('budget.exceeded', {
            userId: user.id,
            name: b.name,
            consumedPct: b.consumedPct,
          });
        }
      }
    } catch (err) {
      this.logger.error(`budget alert job failed: ${(err as Error).message}`);
    }
  }

  /** Anomaly sweep on yesterday's activity. */
  @Cron('30 7 * * *', { name: 'anomaly-scan' })
  async anomalyScan(): Promise<void> {
    try {
      const since = new Date(Date.now() - 90 * 864e5);
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const user of users) {
        const res = await this.analytics.anomalies(user.id, { from: since, to: new Date() });
        const yesterday = Date.now() - 864e5;
        const fresh = res.items.filter((a) => new Date(a.date).getTime() >= yesterday);
        if (!fresh.length) continue;
        this.events.emit('anomaly.detected', { userId: user.id, items: fresh });
      }
    } catch (err) {
      this.logger.error(`anomaly job failed: ${(err as Error).message}`);
    }
  }

  /** Housekeeping: expired tokens and stale cache entries. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'housekeeping' })
  async housekeeping(): Promise<void> {
    try {
      const tokens = await this.auth.pruneTokens();
      const purged = await this.prisma.transaction.deleteMany({
        where: { isDeleted: true, deletedAt: { lt: new Date(Date.now() - 60 * 864e5) } },
      });
      this.logger.log(`housekeeping: ${tokens} tokens, ${purged.count} purged transactions`);
    } catch (err) {
      this.logger.error(`housekeeping failed: ${(err as Error).message}`);
    }
  }

  /** Cheap cache eviction so memory does not creep. */
  @Interval('cache-prune', 120_000)
  pruneCache(): void {
    this.cache.prune();
  }
}

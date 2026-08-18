import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { NotificationType } from 'src/common/types/domain.types';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  severity?: 'info' | 'warning' | 'critical' | 'success';
  meta?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(userId: string, unreadOnly = false, limit = 50) {
    const items = await this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unread = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return {
      items: items.map((n) => ({ ...n, meta: n.meta ? safeParse(n.meta) : null })),
      unread,
    };
  }

  async create(input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        severity: input.severity ?? 'info',
        meta: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
    // Push to any live socket for this user.
    this.events.emit('notification.created', { userId: input.userId, notification });
    return notification;
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { id, isRead: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: res.count };
  }

  async remove(userId: string, id: string) {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
    return { id, deleted: true as const };
  }

  // --- event listeners ------------------------------------------------

  @OnEvent('recurring.posted')
  async onRecurringPosted(p: { userId: string; description: string; amount: number }) {
    await this.create({
      userId: p.userId,
      type: 'RECURRING_POSTED',
      severity: 'info',
      title: 'Recurring charge posted',
      body: `${p.description} for ${p.amount} was added automatically.`,
      meta: { amount: p.amount },
    });
  }

  @OnEvent('goal.reached')
  async onGoalReached(p: { userId: string; name: string }) {
    await this.create({
      userId: p.userId,
      type: 'GOAL_REACHED',
      severity: 'success',
      title: 'Goal reached',
      body: `You hit your "${p.name}" savings goal.`,
    });
  }

  @OnEvent('budget.exceeded')
  async onBudgetExceeded(p: { userId: string; name: string; consumedPct: number }) {
    await this.create({
      userId: p.userId,
      type: 'BUDGET_ALERT',
      severity: p.consumedPct >= 100 ? 'critical' : 'warning',
      title: p.consumedPct >= 100 ? 'Budget exceeded' : 'Budget nearly spent',
      body: `"${p.name}" is at ${p.consumedPct}% of its limit.`,
      meta: { consumedPct: p.consumedPct },
    });
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

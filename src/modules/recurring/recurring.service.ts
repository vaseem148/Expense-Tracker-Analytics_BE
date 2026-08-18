import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { Frequency } from 'src/common/types/domain.types';
import { normaliseMerchant, transactionHash } from 'src/common/utils/merchant';
import { roundTo, toMajor, toMinor } from 'src/common/utils/money';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { nextOccurrence, occurrencesPerYear } from './recurrence';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  async findAll(userId: string) {
    const rules = await this.prisma.recurringRule.findMany({
      where: { userId },
      include: {
        category: { select: { name: true, color: true, icon: true } },
        account: { select: { name: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: [{ isActive: 'desc' }, { nextRunAt: 'asc' }],
    });

    const monthlyTotal = rules
      .filter((r) => r.isActive && r.type === 'EXPENSE')
      .reduce(
        (acc, r) =>
          acc +
          (toMajor(r.amountMinor) * occurrencesPerYear(r.frequency as Frequency, r.interval)) / 12,
        0,
      );

    return {
      items: rules.map((r) => ({
        id: r.id,
        description: r.description,
        merchant: r.merchant,
        amount: toMajor(r.amountMinor),
        type: r.type,
        frequency: r.frequency,
        interval: r.interval,
        dayOfMonth: r.dayOfMonth,
        weekday: r.weekday,
        startDate: r.startDate,
        endDate: r.endDate,
        nextRunAt: r.nextRunAt,
        lastRunAt: r.lastRunAt,
        autoPost: r.autoPost,
        isActive: r.isActive,
        accountName: r.account.name,
        categoryName: r.category?.name ?? 'Uncategorised',
        categoryColor: r.category?.color ?? '#94a3b8',
        categoryIcon: r.category?.icon ?? 'repeat',
        postedCount: r._count.transactions,
        annualCost: roundTo(
          toMajor(r.amountMinor) * occurrencesPerYear(r.frequency as Frequency, r.interval),
          2,
        ),
        daysUntilNext: Math.ceil((r.nextRunAt.getTime() - Date.now()) / 864e5),
      })),
      summary: {
        active: rules.filter((r) => r.isActive).length,
        monthlyCommitment: roundTo(monthlyTotal, 2),
        annualCommitment: roundTo(monthlyTotal * 12, 2),
      },
    };
  }

  async create(userId: string, dto: CreateRecurringDto) {
    const start = new Date(dto.startDate);
    const rule = await this.prisma.recurringRule.create({
      data: {
        userId,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
        type: dto.type ?? 'EXPENSE',
        amountMinor: toMinor(dto.amount),
        description: dto.description.trim(),
        merchant: dto.merchant ?? null,
        frequency: dto.frequency ?? 'MONTHLY',
        interval: dto.interval ?? 1,
        dayOfMonth: dto.dayOfMonth ?? null,
        weekday: dto.weekday ?? null,
        startDate: start,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        // A rule created with a past start date fires on its next future slot.
        nextRunAt: start > new Date() ? start : this.advance(start, dto),
        autoPost: dto.autoPost ?? true,
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return { ...rule, amount: toMajor(rule.amountMinor) };
  }

  async update(userId: string, id: string, dto: UpdateRecurringDto) {
    const existing = await this.prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Recurring rule not found');

    const rule = await this.prisma.recurringRule.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.amount !== undefined ? { amountMinor: toMinor(dto.amount) } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
        ...(dto.dayOfMonth !== undefined ? { dayOfMonth: dto.dayOfMonth } : {}),
        ...(dto.weekday !== undefined ? { weekday: dto.weekday } : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
          : {}),
        ...(dto.autoPost !== undefined ? { autoPost: dto.autoPost } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.merchant !== undefined ? { merchant: dto.merchant } : {}),
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return { ...rule, amount: toMajor(rule.amountMinor) };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Recurring rule not found');
    await this.prisma.recurringRule.delete({ where: { id } });
    this.cache.invalidate(`analytics:${userId}`);
    return { id, deleted: true as const };
  }

  /** Posts a rule immediately without waiting for the scheduler. */
  async runNow(userId: string, id: string) {
    const rule = await this.prisma.recurringRule.findFirst({ where: { id, userId } });
    if (!rule) throw new NotFoundException('Recurring rule not found');
    const tx = await this.post(rule);
    return { posted: Boolean(tx), transactionId: tx?.id ?? null };
  }

  /**
   * Scheduler entry point: materialises every rule whose nextRunAt has passed.
   */
  async processDue(now = new Date()): Promise<{ posted: number; skipped: number }> {
    const due = await this.prisma.recurringRule.findMany({
      where: { isActive: true, autoPost: true, nextRunAt: { lte: now } },
      take: 500,
    });

    let posted = 0;
    let skipped = 0;
    for (const rule of due) {
      if (rule.endDate && rule.endDate < now) {
        await this.prisma.recurringRule.update({ where: { id: rule.id }, data: { isActive: false } });
        skipped++;
        continue;
      }
      const tx = await this.post(rule);
      if (tx) posted++;
      else skipped++;
    }
    if (posted) this.logger.log(`posted ${posted} recurring transaction(s)`);
    return { posted, skipped };
  }

  private async post(rule: {
    id: string;
    userId: string;
    accountId: string;
    categoryId: string | null;
    type: string;
    amountMinor: number;
    description: string;
    merchant: string | null;
    frequency: string;
    interval: number;
    dayOfMonth: number | null;
    weekday: number | null;
    nextRunAt: Date;
  }) {
    const date = rule.nextRunAt;
    const hash = transactionHash({
      accountId: rule.accountId,
      date,
      amountMinor: rule.amountMinor,
      description: rule.description,
      type: rule.type,
    });

    // A unique externalHash makes re-running the scheduler idempotent.
    const existing = await this.prisma.transaction.findFirst({
      where: { userId: rule.userId, externalHash: hash },
      select: { id: true },
    });

    let created = existing;
    if (!existing) {
      created = await this.prisma.transaction.create({
        data: {
          userId: rule.userId,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          type: rule.type,
          amountMinor: rule.amountMinor,
          description: rule.description,
          merchant: rule.merchant,
          merchantKey: normaliseMerchant(rule.merchant ?? rule.description),
          date,
          isRecurring: true,
          recurringId: rule.id,
          externalHash: hash,
        },
        select: { id: true },
      });
      this.events.emit('recurring.posted', {
        userId: rule.userId,
        ruleId: rule.id,
        description: rule.description,
        amount: toMajor(rule.amountMinor),
      });
    }

    await this.prisma.recurringRule.update({
      where: { id: rule.id },
      data: {
        lastRunAt: date,
        nextRunAt: nextOccurrence(
          date,
          rule.frequency as Frequency,
          rule.interval,
          rule.dayOfMonth,
          rule.weekday,
        ),
      },
    });
    this.cache.invalidate(`analytics:${rule.userId}`);
    return created;
  }

  /** Walks a past start date forward to the first slot in the future. */
  private advance(from: Date, dto: CreateRecurringDto): Date {
    let cursor = new Date(from);
    const now = new Date();
    let guard = 0;
    while (cursor <= now && guard++ < 500) {
      cursor = nextOccurrence(
        cursor,
        dto.frequency ?? 'MONTHLY',
        dto.interval ?? 1,
        dto.dayOfMonth,
        dto.weekday,
      );
    }
    return cursor;
  }
}

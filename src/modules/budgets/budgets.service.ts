import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { OrgContextService } from 'src/common/org/org-context.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { toMajor, toMinor } from 'src/common/utils/money';
import { AnalyticsService } from '../analytics/analytics.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly analytics: AnalyticsService,
    private readonly orgs: OrgContextService,
  ) {}

  /** Budgets always come back with live consumption - a bare limit is useless. */
  async findAll(userId: string) {
    return this.analytics.budgetPerformance(userId);
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.orgs.resolve(userId);
    const budget = await this.prisma.budget.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { category: { select: { name: true, color: true } } },
    });
    if (!budget) throw new NotFoundException('Budget not found');
    const perf = await this.analytics.budgetPerformance(userId);
    return perf.items.find((b) => b.id === id) ?? { ...budget, limit: toMajor(budget.amountMinor) };
  }

  async create(userId: string, dto: CreateBudgetDto) {
    // FINANCE owns the company plan; a manager cannot quietly raise their own cap.
    const ctx = await this.orgs.require(userId, dto.orgId, 'FINANCE');
    const budget = await this.prisma.budget.create({
      data: {
        userId,
        name: dto.name.trim(),
        amountMinor: toMinor(dto.amount),
        period: dto.period ?? 'MONTHLY',
        categoryId: dto.categoryId ?? null,
        orgId: ctx.orgId,
        departmentId: dto.departmentId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        rollover: dto.rollover ?? false,
        alertThreshold: dto.alertThreshold ?? 0.8,
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return { ...budget, amount: toMajor(budget.amountMinor) };
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    await this.assertOwned(userId, id);
    const budget = await this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.amount !== undefined ? { amountMinor: toMinor(dto.amount) } : {}),
        ...(dto.period !== undefined ? { period: dto.period } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.rollover !== undefined ? { rollover: dto.rollover } : {}),
        ...(dto.alertThreshold !== undefined ? { alertThreshold: dto.alertThreshold } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return { ...budget, amount: toMajor(budget.amountMinor) };
  }

  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.budget.delete({ where: { id } });
    this.cache.invalidate(`analytics:${userId}`);
    return { id, deleted: true as const };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const ctx = await this.orgs.require(userId, undefined, 'FINANCE');
    const found = await this.prisma.budget.findFirst({
      where: { id, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Budget not found');
  }
}

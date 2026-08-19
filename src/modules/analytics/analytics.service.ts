import { Injectable } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { Granularity } from 'src/common/types/domain.types';
import {
  bucketKey,
  daysBetween,
  defaultRange,
  enumerateBuckets,
  previousPeriod,
  seasonalPeriod,
} from 'src/common/utils/date';
import { forecast } from 'src/common/utils/forecast';
import { pctChange, roundTo, share, toMajor } from 'src/common/utils/money';
import { coefficientOfVariation, mean, sum } from 'src/common/utils/stats';
import {
  buildCategoryBreakdown,
  buildHeatmap,
  buildMerchants,
  buildPareto,
  buildSeries,
  detectRecurringCandidates,
  findAnomalies,
  spendDistribution,
} from './engine/timeseries.engine';
import { financialHealthScore, generateInsights } from './engine/insights.engine';
import { LedgerRow } from './engine/ledger.types';

interface Window {
  from: Date;
  to: Date;
}

const CACHE_TTL = 45_000;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Single point of DB access for analytics. Everything downstream is pure,
   * so one query feeds a dozen different computations.
   */
  async loadLedger(userId: string, w: Window, orgId?: string): Promise<LedgerRow[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        isDeleted: false,
        date: { gte: w.from, lte: w.to },
        // Personal analytics must exclude company spend: a founder who also
        // runs the business ledger would otherwise see corporate opex folded
        // into their own savings rate and budgets.
        ...(orgId ? { orgId } : { scope: 'PERSONAL' }),
      },
      select: {
        id: true,
        date: true,
        amountMinor: true,
        type: true,
        description: true,
        merchant: true,
        merchantKey: true,
        paymentMethod: true,
        isRecurring: true,
        scope: true,
        taxAmountMinor: true,
        isBillable: true,
        projectId: true,
        categoryId: true,
        accountId: true,
        departmentId: true,
        vendorId: true,
        category: { select: { name: true, color: true, icon: true } },
        account: { select: { name: true } },
        department: { select: { name: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      amount: toMajor(r.amountMinor),
      type: r.type as LedgerRow['type'],
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? 'Uncategorised',
      categoryColor: r.category?.color ?? '#94a3b8',
      categoryIcon: r.category?.icon ?? 'circle-help',
      accountId: r.accountId,
      accountName: r.account?.name ?? 'Unknown',
      merchantKey: r.merchantKey,
      merchant: r.merchant,
      description: r.description,
      paymentMethod: r.paymentMethod,
      isRecurring: r.isRecurring,
      scope: r.scope,
      taxAmount: toMajor(r.taxAmountMinor),
      departmentId: r.departmentId,
      departmentName: r.department?.name ?? null,
      vendorId: r.vendorId,
      vendorName: r.vendor?.name ?? null,
      projectId: r.projectId,
      isBillable: r.isBillable,
    }));
  }

  private key(userId: string, name: string, w: Window, extra = ''): string {
    return `analytics:${userId}:${name}:${w.from.toISOString().slice(0, 10)}:${w.to.toISOString().slice(0, 10)}:${extra}`;
  }

  /** Headline KPI tiles for the dashboard. */
  async overview(userId: string, w: Window = defaultRange()) {
    return this.cache.wrap(this.key(userId, 'overview', w), CACHE_TTL, async () => {
      const prev = previousPeriod(w.from, w.to);
      const [rows, prevRows, user] = await Promise.all([
        this.loadLedger(userId, w),
        this.loadLedger(userId, prev),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { currency: true, monthlyIncome: true },
        }),
      ]);

      const expense = sum(rows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));
      const income = sum(rows.filter((r) => r.type === 'INCOME').map((r) => r.amount));
      const prevExpense = sum(prevRows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));
      const prevIncome = sum(prevRows.filter((r) => r.type === 'INCOME').map((r) => r.amount));
      const days = Math.max(1, daysBetween(w.from, w.to));
      const categories = buildCategoryBreakdown(rows, w.from, w.to, 'month');
      const declaredIncome = toMajor(user?.monthlyIncome ?? 0);

      return {
        currency: user?.currency ?? 'INR',
        range: { from: w.from.toISOString(), to: w.to.toISOString(), days },
        totals: {
          expense: roundTo(expense, 2),
          income: roundTo(income, 2),
          net: roundTo(income - expense, 2),
          transactions: rows.length,
          transfers: rows.filter((r) => r.type === 'TRANSFER').length,
        },
        rates: {
          dailyBurn: roundTo(expense / days, 2),
          monthlyRunRate: roundTo((expense / days) * 30, 2),
          savingsRate: income > 0 ? roundTo(((income - expense) / income) * 100, 1) : null,
          expenseToIncome: income > 0 ? roundTo((expense / income) * 100, 1) : null,
          averageTransaction: rows.length ? roundTo(expense / Math.max(1, rows.filter((r) => r.type === 'EXPENSE').length), 2) : 0,
        },
        comparison: {
          expenseChangePct: pctChange(prevExpense, expense),
          incomeChangePct: pctChange(prevIncome, income),
          previousExpense: roundTo(prevExpense, 2),
          previousIncome: roundTo(prevIncome, 2),
        },
        topCategory: categories[0]
          ? {
              name: categories[0].name,
              color: categories[0].color,
              total: categories[0].total,
              share: categories[0].share,
            }
          : null,
        budgetedIncome: declaredIncome,
        projectedMonthEnd: roundTo((expense / days) * 30, 2),
      };
    });
  }

  async timeseries(userId: string, w: Window, g: Granularity = 'month', withForecast = true) {
    return this.cache.wrap(this.key(userId, 'series', w, g), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      const series = buildSeries(rows, w.from, w.to, g);
      const expenses = series.map((s) => s.expense);

      const fc = withForecast
        ? forecast(expenses, g === 'day' ? 14 : 3, seasonalPeriod(g))
        : null;

      const futureBuckets =
        fc && fc.points.length
          ? enumerateBuckets(w.to, addBucketsSafe(w.to, g, fc.points.length), g).slice(1)
          : [];

      return {
        granularity: g,
        series,
        stats: {
          total: roundTo(sum(expenses), 2),
          average: roundTo(mean(expenses), 2),
          peak: series.reduce<{ label: string; value: number }>(
            (acc, s) => (s.expense > acc.value ? { label: s.label, value: s.expense } : acc),
            { label: '-', value: 0 },
          ),
          volatility: roundTo(coefficientOfVariation(expenses), 3),
        },
        forecast: fc
          ? {
              method: fc.method,
              confidence: fc.confidence,
              mape: fc.mape,
              points: fc.points.map((p, i) => ({
                label: futureBuckets[i] ? bucketKey(futureBuckets[i], g) : `+${i + 1}`,
                date: futureBuckets[i]?.toISOString() ?? null,
                value: roundTo(p.value, 2),
                lower: roundTo(p.lower, 2),
                upper: roundTo(p.upper, 2),
              })),
            }
          : null,
      };
    });
  }

  async categories(userId: string, w: Window, g: Granularity = 'month', type: 'EXPENSE' | 'INCOME' = 'EXPENSE') {
    return this.cache.wrap(this.key(userId, `cats:${type}`, w, g), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      const slices = buildCategoryBreakdown(rows, w.from, w.to, g, type);
      return { type, slices, pareto: buildPareto(slices) };
    });
  }

  async merchants(userId: string, w: Window, limit = 20) {
    return this.cache.wrap(this.key(userId, 'merchants', w, String(limit)), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      return buildMerchants(rows, limit);
    });
  }

  async cashflow(userId: string, w: Window, g: Granularity = 'month') {
    return this.cache.wrap(this.key(userId, 'cashflow', w, g), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      const series = buildSeries(rows, w.from, w.to, g);
      const positives = series.filter((s) => s.net > 0).length;
      return {
        series,
        summary: {
          inflow: roundTo(sum(series.map((s) => s.income)), 2),
          outflow: roundTo(sum(series.map((s) => s.expense)), 2),
          net: roundTo(sum(series.map((s) => s.net)), 2),
          positivePeriods: positives,
          negativePeriods: series.length - positives,
          bestPeriod: series.reduce<{ label: string; net: number } | null>(
            (a, s) => (!a || s.net > a.net ? { label: s.label, net: s.net } : a),
            null,
          ),
          worstPeriod: series.reduce<{ label: string; net: number } | null>(
            (a, s) => (!a || s.net < a.net ? { label: s.label, net: s.net } : a),
            null,
          ),
        },
      };
    });
  }

  async heatmap(userId: string, w: Window) {
    return this.cache.wrap(this.key(userId, 'heatmap', w), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      return buildHeatmap(rows);
    });
  }

  async anomalies(userId: string, w: Window, threshold = 3) {
    return this.cache.wrap(this.key(userId, 'anomalies', w, String(threshold)), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      return { threshold, items: findAnomalies(rows, threshold), distribution: spendDistribution(rows) };
    });
  }

  async recurringCandidates(userId: string, w: Window) {
    return this.cache.wrap(this.key(userId, 'recurring', w), CACHE_TTL, async () => {
      const rows = await this.loadLedger(userId, w);
      const items = detectRecurringCandidates(rows);
      return {
        items,
        totalAnnualCost: roundTo(sum(items.map((i) => i.annualisedCost)), 2),
        totalMonthlyCost: roundTo(sum(items.map((i) => i.annualisedCost)) / 12, 2),
      };
    });
  }

  /** Everything the dashboard needs in one round trip. */
  async dashboard(userId: string, w: Window, g: Granularity = 'month') {
    const [overview, series, categories, merchants, anomalies, recurring, budgets] =
      await Promise.all([
        this.overview(userId, w),
        this.timeseries(userId, w, g),
        this.categories(userId, w, g),
        this.merchants(userId, w, 8),
        this.anomalies(userId, w),
        this.recurringCandidates(userId, w),
        this.budgetPerformance(userId),
      ]);

    const rows = await this.loadLedger(userId, w);
    const expenseSeries = series.series.map((s) => s.expense);
    const incomeSeries = series.series.map((s) => s.income);
    const recurringSpend = sum(
      rows.filter((r) => r.isRecurring && r.type === 'EXPENSE').map((r) => r.amount),
    );

    const health = financialHealthScore({
      savingsRate: overview.rates.savingsRate ?? 0,
      budgetAdherence: budgets.adherencePct,
      expenseVolatility: coefficientOfVariation(expenseSeries),
      recurringShare: share(recurringSpend, overview.totals.expense),
      incomeStability: Math.max(0, 100 - coefficientOfVariation(incomeSeries) * 100),
    });

    const insights = generateInsights({
      rows,
      series: series.series,
      categories: categories.slices,
      totalExpense: overview.totals.expense,
      totalIncome: overview.totals.income,
      previousExpense: overview.comparison.previousExpense,
      anomalies: anomalies.items.slice(0, 5).map((a) => ({
        description: a.description,
        amount: a.amount,
        category: a.category,
      })),
      recurringAnnualCost: recurring.totalAnnualCost,
      budgetBreaches: budgets.items
        .filter((b) => b.consumedPct >= b.alertThresholdPct)
        .map((b) => ({ name: b.name, consumedPct: b.consumedPct })),
      currency: overview.currency,
      days: overview.range.days,
    });

    return {
      overview,
      series,
      categories,
      merchants,
      anomalies: anomalies.items.slice(0, 10),
      recurring,
      budgets,
      health,
      insights,
    };
  }

  /** Budget vs actual for every active budget in its current period. */
  async budgetPerformance(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, isActive: true },
      include: { category: { select: { name: true, color: true } } },
    });

    // A budget on a parent category has to cover its children, otherwise a
    // "Food & Dining" cap reads zero while every rupee sits under Groceries
    // and Restaurants.
    const children = await this.prisma.category.findMany({
      where: { userId, parentId: { not: null } },
      select: { id: true, parentId: true },
    });
    const descendants = new Map<string, string[]>();
    for (const c of children) {
      const list = descendants.get(c.parentId!) ?? [];
      list.push(c.id);
      descendants.set(c.parentId!, list);
    }

    const items = [];
    let weightedAdherence = 0;
    let weight = 0;

    for (const b of budgets) {
      const { start, end } = currentPeriodWindow(b.period, b.startDate);
      const agg = await this.prisma.transaction.aggregate({
        where: {
          userId,
          isDeleted: false,
          type: 'EXPENSE',
          date: { gte: start, lte: end },
          ...(b.categoryId
            ? { categoryId: { in: [b.categoryId, ...(descendants.get(b.categoryId) ?? [])] } }
            : {}),
          // A personal budget counts personal spend only; an org budget counts
          // that org. Mixing them would blow a household cap on the first
          // company invoice.
          ...(b.orgId ? { orgId: b.orgId } : { scope: 'PERSONAL' }),
        },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });

      const spent = toMajor(agg._sum.amountMinor ?? 0);
      const limit = toMajor(b.amountMinor);
      const consumedPct = limit > 0 ? roundTo((spent / limit) * 100, 1) : 0;
      const daysTotal = Math.max(1, daysBetween(start, end));
      const daysElapsed = Math.min(daysTotal, Math.max(1, daysBetween(start, new Date())));
      const pace = roundTo((daysElapsed / daysTotal) * 100, 1);

      weightedAdherence += Math.min(100, Math.max(0, 100 - Math.max(0, consumedPct - 100))) * limit;
      weight += limit;

      items.push({
        id: b.id,
        name: b.name,
        period: b.period,
        categoryId: b.categoryId,
        categoryName: b.category?.name ?? 'All categories',
        categoryColor: b.category?.color ?? '#6366f1',
        limit,
        spent,
        remaining: roundTo(limit - spent, 2),
        consumedPct,
        pacePct: pace,
        // Ahead of pace = burning the budget faster than the clock.
        status: consumedPct >= 100 ? 'exceeded' : consumedPct > pace + 10 ? 'at-risk' : 'on-track',
        projectedSpend: roundTo(daysElapsed > 0 ? (spent / daysElapsed) * daysTotal : 0, 2),
        transactions: agg._count._all,
        alertThresholdPct: roundTo(b.alertThreshold * 100, 0),
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
      });
    }

    return {
      items: items.sort((a, b) => b.consumedPct - a.consumedPct),
      adherencePct: weight > 0 ? roundTo(weightedAdherence / weight, 1) : 100,
      totalBudgeted: roundTo(sum(items.map((i) => i.limit)), 2),
      totalSpent: roundTo(sum(items.map((i) => i.spent)), 2),
      exceeded: items.filter((i) => i.status === 'exceeded').length,
      atRisk: items.filter((i) => i.status === 'at-risk').length,
    };
  }

  /** Side-by-side comparison of two arbitrary windows. */
  async compare(userId: string, a: Window, b: Window, g: Granularity = 'month') {
    const [rowsA, rowsB] = await Promise.all([
      this.loadLedger(userId, a),
      this.loadLedger(userId, b),
    ]);
    const catsA = buildCategoryBreakdown(rowsA, a.from, a.to, g);
    const catsB = buildCategoryBreakdown(rowsB, b.from, b.to, g);
    const mapB = new Map(catsB.map((c) => [c.name, c.total]));

    const byCategory = catsA.map((c) => {
      const prev = mapB.get(c.name) ?? 0;
      return {
        name: c.name,
        color: c.color,
        current: c.total,
        previous: roundTo(prev, 2),
        delta: roundTo(c.total - prev, 2),
        deltaPct: pctChange(prev, c.total),
      };
    });

    for (const c of catsB) {
      if (!catsA.find((x) => x.name === c.name)) {
        byCategory.push({
          name: c.name,
          color: c.color,
          current: 0,
          previous: c.total,
          delta: roundTo(-c.total, 2),
          deltaPct: -100,
        });
      }
    }

    const expA = sum(rowsA.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));
    const expB = sum(rowsB.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));

    return {
      current: { from: a.from.toISOString(), to: a.to.toISOString(), expense: roundTo(expA, 2) },
      previous: { from: b.from.toISOString(), to: b.to.toISOString(), expense: roundTo(expB, 2) },
      deltaPct: pctChange(expB, expA),
      byCategory: byCategory.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
      biggestIncrease:
        byCategory.filter((c) => c.delta > 0).sort((x, y) => y.delta - x.delta)[0] ?? null,
      biggestDecrease:
        byCategory.filter((c) => c.delta < 0).sort((x, y) => x.delta - y.delta)[0] ?? null,
    };
  }
}

/** Bucket arithmetic helper kept local to avoid a circular import. */
function addBucketsSafe(date: Date, g: Granularity, n: number): Date {
  const d = new Date(date);
  switch (g) {
    case 'day':
      d.setDate(d.getDate() + n);
      break;
    case 'week':
      d.setDate(d.getDate() + n * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + n);
      break;
    case 'quarter':
      d.setMonth(d.getMonth() + n * 3);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + n);
      break;
  }
  return d;
}

/** Resolves the live window of a recurring budget period. */
function currentPeriodWindow(period: string, anchor: Date): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  switch (period) {
    case 'WEEKLY': {
      const day = (now.getDay() + 6) % 7; // Monday-based
      start.setDate(now.getDate() - day);
      end.setDate(start.getDate() + 6);
      break;
    }
    case 'QUARTERLY': {
      const q = Math.floor(now.getMonth() / 3);
      start.setMonth(q * 3, 1);
      end.setMonth(q * 3 + 3, 0);
      break;
    }
    case 'YEARLY': {
      start.setMonth(0, 1);
      end.setMonth(11, 31);
      break;
    }
    default: {
      start.setDate(1);
      end.setMonth(now.getMonth() + 1, 0);
    }
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (anchor > start) start.setTime(Math.max(start.getTime(), anchor.getTime()));
  return { start, end };
}

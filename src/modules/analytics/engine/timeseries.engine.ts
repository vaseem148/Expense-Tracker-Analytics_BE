import { Granularity } from 'src/common/types/domain.types';
import { addBuckets, bucketKey, bucketLabel, bucketStart, enumerateBuckets } from 'src/common/utils/date';
import { pctChange, roundTo, share } from 'src/common/utils/money';
import {
  coefficientOfVariation,
  detectOutliers,
  gini,
  linearRegression,
  mean,
  median,
  movingAverage,
  quantile,
  stdev,
  sum,
} from 'src/common/utils/stats';
import { CategorySlice, LedgerRow, MerchantSlice, SeriesPoint } from './ledger.types';

/**
 * Pure functions over an already-loaded ledger. Keeping them free of Prisma
 * and Nest makes the maths unit-testable and reusable by the CSV exporter,
 * the scheduler and the ML feature builder alike.
 */

export function buildSeries(
  rows: LedgerRow[],
  from: Date,
  to: Date,
  g: Granularity,
  maWindow = 3,
): SeriesPoint[] {
  const buckets = enumerateBuckets(from, to, g);
  const map = new Map<string, { expense: number; income: number; count: number }>();

  for (const b of buckets) map.set(bucketKey(b, g), { expense: 0, income: 0, count: 0 });
  for (const r of rows) {
    if (r.type === 'TRANSFER') continue; // relocation, not consumption
    const key = bucketKey(r.date, g);
    const slot = map.get(key);
    if (!slot) continue;
    if (r.type === 'EXPENSE') slot.expense += r.amount;
    else slot.income += r.amount;
    slot.count++;
  }

  const expenses = buckets.map((b) => map.get(bucketKey(b, g))!.expense);
  const ma = movingAverage(expenses, maWindow);

  let cumulative = 0;
  return buckets.map((b, i) => {
    const slot = map.get(bucketKey(b, g))!;
    const net = slot.income - slot.expense;
    cumulative += net;
    return {
      key: bucketKey(b, g),
      label: bucketLabel(b, g),
      date: b.toISOString(),
      expense: roundTo(slot.expense, 2),
      income: roundTo(slot.income, 2),
      net: roundTo(net, 2),
      count: slot.count,
      movingAvg: ma[i] === null ? null : roundTo(ma[i]!, 2),
      cumulative: roundTo(cumulative, 2),
    };
  });
}

export function buildCategoryBreakdown(
  rows: LedgerRow[],
  from: Date,
  to: Date,
  g: Granularity = 'month',
  type: 'EXPENSE' | 'INCOME' = 'EXPENSE',
): CategorySlice[] {
  const relevant = rows.filter((r) => r.type === type);
  const total = sum(relevant.map((r) => r.amount));
  const groups = new Map<string, LedgerRow[]>();

  for (const r of relevant) {
    const key = r.categoryId ?? '__uncategorised__';
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const buckets = enumerateBuckets(from, to, g).map((b) => bucketKey(b, g));

  const slices: CategorySlice[] = [];
  for (const [categoryId, items] of groups) {
    const amounts = items.map((r) => r.amount);
    const perBucket = new Map<string, number>(buckets.map((b) => [b, 0]));
    for (const r of items) {
      const k = bucketKey(r.date, g);
      if (perBucket.has(k)) perBucket.set(k, perBucket.get(k)! + r.amount);
    }
    const sparkline = [...perBucket.values()].map((v) => roundTo(v, 2));
    // Trend = OLS slope over the sparkline, expressed as % of the mean bucket.
    const fit = linearRegression(sparkline);
    const avgBucket = mean(sparkline);

    slices.push({
      categoryId: categoryId === '__uncategorised__' ? null : categoryId,
      name: items[0].categoryName,
      color: items[0].categoryColor,
      icon: items[0].categoryIcon,
      total: roundTo(sum(amounts), 2),
      count: items.length,
      share: share(sum(amounts), total),
      average: roundTo(mean(amounts), 2),
      largest: roundTo(Math.max(...amounts), 2),
      trendPct: avgBucket === 0 ? null : roundTo((fit.slope / avgBucket) * 100, 1),
      volatility: roundTo(coefficientOfVariation(sparkline), 3),
      sparkline,
    });
  }

  return slices.sort((a, b) => b.total - a.total);
}

export function buildMerchants(rows: LedgerRow[], limit = 20): MerchantSlice[] {
  const expenses = rows.filter((r) => r.type === 'EXPENSE' && r.merchantKey);
  const total = sum(expenses.map((r) => r.amount));
  const groups = new Map<string, LedgerRow[]>();
  for (const r of expenses) {
    const list = groups.get(r.merchantKey!);
    if (list) list.push(r);
    else groups.set(r.merchantKey!, [r]);
  }

  const out: MerchantSlice[] = [];
  for (const [key, items] of groups) {
    const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 864e5);
    }
    const amounts = items.map((r) => r.amount);
    out.push({
      merchantKey: key,
      name: items.find((i) => i.merchant)?.merchant ?? titleCase(key),
      total: roundTo(sum(amounts), 2),
      count: items.length,
      average: roundTo(mean(amounts), 2),
      share: share(sum(amounts), total),
      firstSeen: sorted[0].date.toISOString(),
      lastSeen: sorted[sorted.length - 1].date.toISOString(),
      cadenceDays: gaps.length >= 2 ? roundTo(median(gaps), 1) : null,
    });
  }

  return out.sort((a, b) => b.total - a.total).slice(0, limit);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Calendar heatmap: spend per weekday x hour-of-day, plus per-date totals. */
export function buildHeatmap(rows: LedgerRow[]) {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const byDate = new Map<string, number>();
  const byWeekday = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);

  for (const r of rows) {
    if (r.type !== 'EXPENSE') continue;
    const wd = r.date.getDay();
    const hr = r.date.getHours();
    grid[wd][hr] += r.amount;
    byWeekday[wd] += r.amount;
    byHour[hr] += r.amount;
    const key = r.date.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + r.amount);
  }

  const peakWeekday = byWeekday.indexOf(Math.max(...byWeekday));
  const peakHour = byHour.indexOf(Math.max(...byHour));

  return {
    grid: grid.map((row) => row.map((v) => roundTo(v, 2))),
    byWeekday: byWeekday.map((v) => roundTo(v, 2)),
    byHour: byHour.map((v) => roundTo(v, 2)),
    calendar: [...byDate.entries()]
      .map(([date, value]) => ({ date, value: roundTo(value, 2) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    peakWeekday,
    peakHour,
    weekendShare: share(byWeekday[0] + byWeekday[6], sum(byWeekday)),
  };
}

/**
 * Pareto: the smallest set of categories that covers 80% of spend.
 * Gini quantifies how lopsided the distribution is overall.
 */
export function buildPareto(slices: CategorySlice[]) {
  const total = sum(slices.map((s) => s.total));
  let running = 0;
  const points = slices.map((s) => {
    running += s.total;
    return {
      name: s.name,
      color: s.color,
      total: s.total,
      cumulative: roundTo(running, 2),
      cumulativeShare: share(running, total),
    };
  });
  const vital = points.filter((p, i) => i === 0 || points[i - 1].cumulativeShare < 80);
  return {
    points,
    vitalFew: vital.map((v) => v.name),
    vitalFewShare: vital.length ? points[vital.length - 1].cumulativeShare : 0,
    gini: roundTo(gini(slices.map((s) => s.total)), 3),
    concentration:
      slices.length === 0
        ? 'none'
        : share(slices[0]?.total ?? 0, total) > 40
          ? 'high'
          : share(slices[0]?.total ?? 0, total) > 25
            ? 'moderate'
            : 'low',
  };
}

/** Statistically unusual transactions, scored against their own category. */
export function findAnomalies(rows: LedgerRow[], threshold = 3) {
  const expenses = rows.filter((r) => r.type === 'EXPENSE');
  const byCategory = new Map<string, LedgerRow[]>();
  for (const r of expenses) {
    const key = r.categoryId ?? '__none__';
    const list = byCategory.get(key);
    if (list) list.push(r);
    else byCategory.set(key, [r]);
  }

  const results: {
    transactionId: string;
    date: string;
    amount: number;
    description: string;
    category: string;
    categoryColor: string;
    score: number;
    method: string;
    expected: number;
    deviation: number;
  }[] = [];

  for (const [, items] of byCategory) {
    if (items.length < 5) continue; // too few points to call anything an outlier
    const amounts = items.map((r) => r.amount);
    const expected = median(amounts);
    for (const o of detectOutliers(amounts, threshold)) {
      if (o.score <= 0) continue; // only unusually LARGE spend is interesting
      const row = items[o.index];
      results.push({
        transactionId: row.id,
        date: row.date.toISOString(),
        amount: row.amount,
        description: row.description,
        category: row.categoryName,
        categoryColor: row.categoryColor,
        score: roundTo(o.score, 2),
        method: o.method,
        expected: roundTo(expected, 2),
        deviation: roundTo(row.amount - expected, 2),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/** Descriptive stats for the spend distribution (used by the box plot). */
export function spendDistribution(rows: LedgerRow[]) {
  const amounts = rows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount);
  if (!amounts.length) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, stdev: 0, iqr: 0, count: 0 };
  }
  const q1 = quantile(amounts, 0.25);
  const q3 = quantile(amounts, 0.75);
  return {
    min: roundTo(Math.min(...amounts), 2),
    q1: roundTo(q1, 2),
    median: roundTo(median(amounts), 2),
    q3: roundTo(q3, 2),
    max: roundTo(Math.max(...amounts), 2),
    mean: roundTo(mean(amounts), 2),
    stdev: roundTo(stdev(amounts), 2),
    iqr: roundTo(q3 - q1, 2),
    count: amounts.length,
  };
}

/**
 * Mines the ledger for repeating charges the user never declared.
 * A merchant qualifies when it has 3+ hits, a stable gap (low dispersion)
 * and a stable amount - i.e. it behaves like a subscription.
 */
export function detectRecurringCandidates(rows: LedgerRow[]) {
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (r.type !== 'EXPENSE' || !r.merchantKey || r.isRecurring) continue;
    const list = groups.get(r.merchantKey);
    if (list) list.push(r);
    else groups.set(r.merchantKey, [r]);
  }

  const out = [];
  for (const [key, items] of groups) {
    if (items.length < 3) continue;
    const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 864e5);
    }
    const gapMedian = median(gaps);
    if (gapMedian < 5 || gapMedian > 400) continue;
    const gapCv = coefficientOfVariation(gaps);
    const amounts = sorted.map((r) => r.amount);
    const amountCv = coefficientOfVariation(amounts);
    if (gapCv > 0.35 || amountCv > 0.25) continue;

    const frequency =
      gapMedian <= 9 ? 'WEEKLY' : gapMedian <= 45 ? 'MONTHLY' : gapMedian <= 120 ? 'QUARTERLY' : 'YEARLY';
    const last = sorted[sorted.length - 1];
    const confidence = roundTo(Math.max(0, 1 - (gapCv + amountCv) / 2) * 100, 1);

    out.push({
      merchantKey: key,
      name: last.merchant ?? titleCase(key),
      categoryId: last.categoryId,
      categoryName: last.categoryName,
      occurrences: sorted.length,
      medianGapDays: roundTo(gapMedian, 1),
      frequency,
      averageAmount: roundTo(mean(amounts), 2),
      lastCharged: last.date.toISOString(),
      nextExpected: new Date(last.date.getTime() + gapMedian * 864e5).toISOString(),
      annualisedCost: roundTo((mean(amounts) * 365) / gapMedian, 2),
      confidence,
    });
  }

  return out.sort((a, b) => b.annualisedCost - a.annualisedCost);
}

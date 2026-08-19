import { pctChange, roundTo } from 'src/common/utils/money';
import { clamp, sum } from 'src/common/utils/stats';
import { CategorySlice, Insight, LedgerRow, SeriesPoint } from './ledger.types';

interface InsightInput {
  rows: LedgerRow[];
  series: SeriesPoint[];
  categories: CategorySlice[];
  totalExpense: number;
  totalIncome: number;
  previousExpense: number;
  anomalies: { description: string; amount: number; category: string }[];
  recurringAnnualCost: number;
  budgetBreaches: { name: string; consumedPct: number }[];
  currency: string;
  days: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

/**
 * Rule-based narrative layer. Each rule is cheap, deterministic and
 * explainable - a user can always trace a sentence back to a number,
 * which is what makes the output trustworthy enough to act on.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const {
    series,
    categories,
    totalExpense,
    totalIncome,
    previousExpense,
    anomalies,
    recurringAnnualCost,
    budgetBreaches,
    days,
  } = input;

  // 1. Period-over-period movement
  const delta = pctChange(previousExpense, totalExpense);
  if (delta !== null && previousExpense > 0 && Math.abs(delta) >= 5) {
    out.push({
      id: 'spend-trend',
      severity: delta > 20 ? 'critical' : delta > 0 ? 'warning' : 'positive',
      title: delta > 0 ? `Spending is up ${Math.abs(delta)}%` : `Spending is down ${Math.abs(delta)}%`,
      detail: `You spent ${fmt(totalExpense)} this period versus ${fmt(previousExpense)} in the one before.`,
      metric: delta,
      unit: '%',
      tag: 'trend',
      action: delta > 20 ? 'Review your top categories to find the driver.' : undefined,
    });
  }

  // 2. Net margin
  if (totalIncome > 0) {
    const margin = roundTo(((totalIncome - totalExpense) / totalIncome) * 100, 1);
    out.push({
      id: 'net-margin',
      severity: margin >= 20 ? 'positive' : margin >= 5 ? 'neutral' : 'critical',
      title: `Net margin is ${margin}%`,
      detail:
        margin >= 20
          ? 'Healthy margin - the business funds itself out of revenue.'
          : margin >= 0
            ? 'Thin margin. One vendor renegotiation usually moves this more than headcount cuts.'
            : 'Operating spend exceeded revenue this period.',
      metric: margin,
      unit: '%',
      tag: 'health',
    });
  }

  // 3. Concentration risk
  const top = categories[0];
  if (top && top.share >= 30) {
    out.push({
      id: 'category-concentration',
      severity: top.share >= 45 ? 'warning' : 'neutral',
      title: `${top.name} is ${top.share}% of all spend`,
      detail: `${fmt(top.total)} across ${top.count} entries. One dominant cost centre makes the plan fragile.`,
      metric: top.share,
      unit: '%',
      tag: 'concentration',
    });
  }

  // 4. Fastest-growing category
  const growing = categories
    .filter((c) => c.trendPct !== null && c.total > totalExpense * 0.05)
    .sort((a, b) => (b.trendPct ?? 0) - (a.trendPct ?? 0))[0];
  if (growing && (growing.trendPct ?? 0) > 15) {
    out.push({
      id: 'category-growth',
      severity: 'warning',
      title: `${growing.name} is trending up`,
      detail: `Per-period spend is climbing about ${growing.trendPct}% each bucket. Left alone it becomes the biggest line item.`,
      metric: growing.trendPct ?? 0,
      unit: '%',
      tag: 'trend',
    });
  }

  // 5. Subscription drag
  if (recurringAnnualCost > 0) {
    const monthly = recurringAnnualCost / 12;
    out.push({
      id: 'recurring-cost',
      severity: totalIncome > 0 && monthly > totalIncome * 0.15 ? 'warning' : 'neutral',
      title: `Committed subscriptions cost ${fmt(monthly)} a month`,
      detail: `That is ${fmt(recurringAnnualCost)} a year of fixed cost before a single decision is made.`,
      metric: roundTo(monthly, 2),
      tag: 'recurring',
      action: 'Audit anything no team has used in 60 days.',
    });
  }

  // 6. Anomalies
  if (anomalies.length) {
    const biggest = anomalies[0];
    out.push({
      id: 'anomaly',
      severity: 'warning',
      title: `${anomalies.length} unusual transaction${anomalies.length > 1 ? 's' : ''} detected`,
      detail: `Largest: ${biggest.description} at ${fmt(biggest.amount)} in ${biggest.category}, well above the norm for that category.`,
      metric: anomalies.length,
      tag: 'anomaly',
    });
  }

  // 7. Budget breaches
  for (const b of budgetBreaches.slice(0, 3)) {
    out.push({
      id: `budget-${b.name}`,
      severity: b.consumedPct >= 100 ? 'critical' : 'warning',
      title:
        b.consumedPct >= 100
          ? `Budget "${b.name}" is over by ${roundTo(b.consumedPct - 100, 1)}%`
          : `Budget "${b.name}" is ${b.consumedPct}% used`,
      detail: 'Adjust the cap or cut the spend before the period closes.',
      metric: b.consumedPct,
      unit: '%',
      tag: 'budget',
    });
  }

  // 8. Burn rate / daily run-rate
  if (days > 0 && totalExpense > 0) {
    const daily = totalExpense / days;
    out.push({
      id: 'burn-rate',
      severity: 'neutral',
      title: `Burn is ${fmt(daily)} a day`,
      detail: `At this pace a 30-day month costs the company about ${fmt(daily * 30)}.`,
      metric: roundTo(daily, 2),
      tag: 'burn',
    });
  }

  // 9. Zero-spend streak (a positive signal worth surfacing)
  const zeroBuckets = series.filter((s) => s.expense === 0).length;
  if (series.length >= 7 && zeroBuckets >= Math.ceil(series.length * 0.3)) {
    out.push({
      id: 'no-spend-days',
      severity: 'positive',
      title: `${zeroBuckets} periods with no spend`,
      detail: 'Quiet periods keep the run-rate down without touching headcount.',
      metric: zeroBuckets,
      tag: 'behaviour',
    });
  }

  return out;
}

/**
 * Composite 0-100 financial health score.
 * Five weighted pillars, each independently explainable so the UI can show
 * exactly why the number moved.
 */
export function financialHealthScore(args: {
  margin: number;
  budgetAdherence: number;
  expenseVolatility: number;
  recurringShare: number;
  revenueStability: number;
}) {
  const pillars = [
    {
      key: 'margin',
      label: 'Net margin',
      weight: 0.3,
      score: clamp((args.margin / 25) * 100, 0, 100),
      hint: 'Target a 20-25% margin on revenue.',
    },
    {
      key: 'budget',
      label: 'Budget adherence',
      weight: 0.25,
      score: clamp(args.budgetAdherence, 0, 100),
      hint: 'Share of budgeted spend that stayed inside the cap.',
    },
    {
      key: 'stability',
      label: 'Spend stability',
      weight: 0.2,
      score: clamp((1 - args.expenseVolatility) * 100, 0, 100),
      hint: 'Lower month-to-month swing scores higher.',
    },
    {
      key: 'commitments',
      label: 'Fixed-cost load',
      weight: 0.15,
      score: clamp(100 - args.recurringShare * 2, 0, 100),
      hint: 'Recurring charges as a share of total spend.',
    },
    {
      key: 'revenue',
      label: 'Revenue consistency',
      weight: 0.1,
      score: clamp(args.revenueStability, 0, 100),
      hint: 'Predictable revenue beats lumpy revenue.',
    },
  ];

  const score = Math.round(sum(pillars.map((p) => p.score * p.weight)));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';

  return {
    score,
    grade,
    pillars: pillars.map((p) => ({ ...p, score: Math.round(p.score) })),
    summary:
      score >= 70
        ? 'Healthy. Spend is controlled and the margin is holding.'
        : score >= 50
          ? 'Workable, but one or two pillars are dragging the score down.'
          : 'Fragile. Fix the lowest pillar first - it moves the score fastest.',
  };
}

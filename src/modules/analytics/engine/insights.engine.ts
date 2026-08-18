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

  // 2. Savings rate
  if (totalIncome > 0) {
    const savingsRate = roundTo(((totalIncome - totalExpense) / totalIncome) * 100, 1);
    out.push({
      id: 'savings-rate',
      severity: savingsRate >= 20 ? 'positive' : savingsRate >= 5 ? 'neutral' : 'critical',
      title: `Savings rate is ${savingsRate}%`,
      detail:
        savingsRate >= 20
          ? 'Comfortably above the 20% benchmark - keep the surplus working.'
          : savingsRate >= 0
            ? 'Below the 20% benchmark. Trimming one recurring charge is usually the fastest fix.'
            : 'You are spending more than you earn this period.',
      metric: savingsRate,
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
      detail: `${fmt(top.total)} across ${top.count} transactions. A single dominant category makes the budget fragile.`,
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
      title: `Recurring charges cost ${fmt(monthly)} a month`,
      detail: `That is ${fmt(recurringAnnualCost)} a year locked in before you decide anything.`,
      metric: roundTo(monthly, 2),
      tag: 'recurring',
      action: 'Cancel anything unused for 60 days.',
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
      title: `Average burn is ${fmt(daily)} a day`,
      detail: `At this pace a 30-day month costs about ${fmt(daily * 30)}.`,
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
      title: `${zeroBuckets} zero-spend periods`,
      detail: 'Long gaps without spending are the cheapest saving mechanism there is.',
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
  savingsRate: number;
  budgetAdherence: number;
  expenseVolatility: number;
  recurringShare: number;
  incomeStability: number;
}) {
  const pillars = [
    {
      key: 'savings',
      label: 'Savings rate',
      weight: 0.3,
      score: clamp((args.savingsRate / 25) * 100, 0, 100),
      hint: 'Target 20-25% of income saved.',
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
      key: 'income',
      label: 'Income consistency',
      weight: 0.1,
      score: clamp(args.incomeStability, 0, 100),
      hint: 'Regular inflow beats lumpy inflow.',
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
        ? 'Healthy. Spending is controlled and savings are compounding.'
        : score >= 50
          ? 'Workable, but one or two pillars are dragging the score down.'
          : 'Fragile. Fix the lowest pillar first - it moves the score fastest.',
  };
}

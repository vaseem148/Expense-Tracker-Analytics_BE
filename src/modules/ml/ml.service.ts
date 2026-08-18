import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { defaultRange } from 'src/common/utils/date';
import { roundTo, toMajor } from 'src/common/utils/money';
import { AnalyticsService } from '../analytics/analytics.service';
import { guessCategory } from '../importexport/auto-categorize';
import { MlClient } from './ml.client';

interface Window {
  from: Date;
  to: Date;
}

export interface CategoryPrediction {
  categoryId: string | null;
  categoryName: string;
  confidence: number;
  source: 'ml' | 'rules';
  alternatives: { categoryName: string; confidence: number }[];
}

/**
 * Orchestrates the data-science layer. Each method tries the Python service
 * first and falls back to a deterministic in-process implementation, so every
 * feature has a defined answer even with the DS service switched off.
 */
@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MlClient,
    private readonly analytics: AnalyticsService,
    private readonly cache: CacheService,
  ) {}

  async status() {
    const available = await this.ml.isAvailable();
    const health = available ? await this.ml.health() : null;
    return {
      serviceAvailable: available,
      mode: available ? 'ml' : 'fallback-rules',
      health,
      capabilities: [
        'category-classification',
        'anomaly-detection',
        'merchant-clustering',
        'spend-forecast',
        'vendor-risk-scoring',
        'cashflow-risk',
      ],
    };
  }

  /** Suggests a category for free text, ML first, keyword rules as backup. */
  async predictCategory(userId: string, description: string, amount?: number): Promise<CategoryPrediction> {
    const categories = await this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, kind: true },
    });

    const remote = await this.ml.call<{
      category: string;
      confidence: number;
      alternatives: { category: string; confidence: number }[];
    }>('/predict/category', { description, amount, labels: categories.map((c) => c.name) });

    if (remote) {
      const match = categories.find((c) => c.name.toLowerCase() === remote.category.toLowerCase());
      return {
        categoryId: match?.id ?? null,
        categoryName: remote.category,
        confidence: roundTo(remote.confidence, 3),
        source: 'ml',
        alternatives: remote.alternatives.map((a) => ({
          categoryName: a.category,
          confidence: roundTo(a.confidence, 3),
        })),
      };
    }

    const guessed = guessCategory(description);
    const match = guessed ? categories.find((c) => c.name === guessed) : undefined;
    return {
      categoryId: match?.id ?? null,
      categoryName: guessed ?? 'Miscellaneous',
      confidence: guessed ? 0.72 : 0.2,
      source: 'rules',
      alternatives: [],
    };
  }

  /** Trains the personal classifier on the user's own labelled history. */
  async trainCategoryModel(userId: string) {
    const rows = await this.prisma.transaction.findMany({
      where: { userId, isDeleted: false, categoryId: { not: null } },
      select: {
        description: true,
        merchant: true,
        amountMinor: true,
        category: { select: { name: true } },
      },
      take: 5000,
    });

    if (rows.length < 20) {
      return { trained: false, reason: 'Need at least 20 categorised transactions', samples: rows.length };
    }

    const result = await this.ml.call<{ accuracy: number; samples: number; classes: number }>(
      '/train/category',
      {
        userId,
        samples: rows.map((r) => ({
          text: `${r.description} ${r.merchant ?? ''}`.trim(),
          amount: toMajor(r.amountMinor),
          label: r.category!.name,
        })),
      },
    );

    if (!result) return { trained: false, reason: 'ML service unavailable', samples: rows.length };
    return { trained: true, ...result };
  }

  /**
   * Isolation-Forest anomaly detection on the DS side, falling back to the
   * robust MAD detector in the TS engine.
   */
  async anomalies(userId: string, w: Window = defaultRange()) {
    const rows = await this.analytics.loadLedger(userId, w);
    const expenses = rows.filter((r) => r.type === 'EXPENSE');

    const remote = await this.ml.call<{
      anomalies: { id: string; score: number; reason: string }[];
      model: string;
      contamination: number;
    }>('/detect/anomalies', {
      transactions: expenses.map((r) => ({
        id: r.id,
        amount: r.amount,
        category: r.categoryName,
        merchant: r.merchantKey ?? r.description,
        dayOfWeek: r.date.getDay(),
        hour: r.date.getHours(),
        isRecurring: r.isRecurring,
      })),
    });

    if (remote) {
      const byId = new Map(expenses.map((r) => [r.id, r]));
      return {
        source: 'ml' as const,
        model: remote.model,
        items: remote.anomalies
          .map((a) => {
            const row = byId.get(a.id);
            if (!row) return null;
            return {
              transactionId: a.id,
              date: row.date.toISOString(),
              amount: row.amount,
              description: row.description,
              category: row.categoryName,
              categoryColor: row.categoryColor,
              score: roundTo(a.score, 3),
              reason: a.reason,
            };
          })
          .filter(Boolean),
      };
    }

    const fallback = await this.analytics.anomalies(userId, w);
    return {
      source: 'fallback' as const,
      model: 'median-absolute-deviation',
      items: fallback.items.map((a) => ({ ...a, reason: `${a.method.toUpperCase()} score ${a.score}` })),
    };
  }

  /** KMeans merchant clustering: groups spend behaviour into named segments. */
  async merchantClusters(userId: string, w: Window = defaultRange()) {
    const rows = await this.analytics.loadLedger(userId, w);
    const groups = new Map<string, { total: number; count: number; amounts: number[]; name: string }>();

    for (const r of rows) {
      if (r.type !== 'EXPENSE' || !r.merchantKey) continue;
      const slot = groups.get(r.merchantKey) ?? {
        total: 0,
        count: 0,
        amounts: [],
        name: r.merchant ?? r.merchantKey,
      };
      slot.total += r.amount;
      slot.count++;
      slot.amounts.push(r.amount);
      groups.set(r.merchantKey, slot);
    }

    const features = [...groups.entries()].map(([key, v]) => ({
      key,
      name: v.name,
      total: roundTo(v.total, 2),
      frequency: v.count,
      averageTicket: roundTo(v.total / v.count, 2),
    }));

    if (features.length < 4) {
      return { source: 'fallback' as const, clusters: [], items: features };
    }

    const remote = await this.ml.call<{
      clusters: { id: number; label: string; size: number; centroid: Record<string, number> }[];
      assignments: Record<string, number>;
    }>('/cluster/merchants', { merchants: features });

    if (remote) {
      return {
        source: 'ml' as const,
        clusters: remote.clusters,
        items: features.map((f) => ({ ...f, cluster: remote.assignments[f.key] ?? -1 })),
      };
    }

    // Deterministic 2x2 segmentation on frequency and ticket size.
    const medFreq = median(features.map((f) => f.frequency));
    const medTicket = median(features.map((f) => f.averageTicket));
    const labelOf = (f: { frequency: number; averageTicket: number }) =>
      f.frequency >= medFreq
        ? f.averageTicket >= medTicket
          ? 'Frequent & expensive'
          : 'Frequent & small'
        : f.averageTicket >= medTicket
          ? 'Rare & expensive'
          : 'Rare & small';

    const labelled = features.map((f) => ({ ...f, clusterLabel: labelOf(f) }));
    const names = [...new Set(labelled.map((l) => l.clusterLabel))];
    return {
      source: 'fallback' as const,
      clusters: names.map((label, id) => ({
        id,
        label,
        size: labelled.filter((l) => l.clusterLabel === label).length,
        centroid: {},
      })),
      items: labelled.map((l) => ({ ...l, cluster: names.indexOf(l.clusterLabel) })),
    };
  }

  /** Vendor risk scoring for the business side; persists the score on Vendor. */
  async scoreVendors(orgId: string) {
    const vendors = await this.prisma.vendor.findMany({
      where: { orgId },
      include: {
        transactions: { where: { isDeleted: false }, select: { amountMinor: true, date: true } },
        invoices: { select: { status: true, dueDate: true, totalMinor: true, paidMinor: true } },
      },
    });

    const payloads = vendors.map((v) => ({
      id: v.id,
      name: v.name,
      transactionCount: v.transactions.length,
      totalSpend: toMajor(v.transactions.reduce((a, t) => a + t.amountMinor, 0)),
      invoiceCount: v.invoices.length,
      overdueInvoices: v.invoices.filter((i) => i.status === 'OVERDUE').length,
      unpaidValue: toMajor(
        v.invoices.reduce((a, i) => a + Math.max(0, i.totalMinor - i.paidMinor), 0),
      ),
      hasGstin: Boolean(v.gstin),
      paymentTermsDays: v.paymentTermsDays,
    }));

    const remote = await this.ml.call<{ scores: { id: string; score: number; drivers: string[] }[] }>(
      '/score/vendors',
      { vendors: payloads },
    );

    const scores =
      remote?.scores ??
      payloads.map((v) => {
        // Concentration, overdue exposure and missing tax identity drive risk.
        let score = 0;
        if (!v.hasGstin) score += 25;
        score += Math.min(30, v.overdueInvoices * 10);
        score += Math.min(25, (v.unpaidValue / Math.max(1, v.totalSpend)) * 100);
        if (v.transactionCount < 3) score += 10;
        if (v.paymentTermsDays > 60) score += 10;
        const drivers: string[] = [];
        if (!v.hasGstin) drivers.push('Missing GSTIN');
        if (v.overdueInvoices) drivers.push(`${v.overdueInvoices} overdue invoice(s)`);
        if (v.transactionCount < 3) drivers.push('Thin transaction history');
        return { id: v.id, score: Math.min(100, Math.round(score)), drivers };
      });

    for (const s of scores) {
      await this.prisma.vendor.update({ where: { id: s.id }, data: { riskScore: s.score } });
    }

    return {
      source: remote ? ('ml' as const) : ('fallback' as const),
      scored: scores.length,
      items: scores
        .map((s) => ({
          ...s,
          name: vendors.find((v) => v.id === s.id)?.name ?? 'Unknown',
        }))
        .sort((a, b) => b.score - a.score),
    };
  }

  /**
   * Cash-flow risk score: the probability the next period ends negative,
   * estimated from the volatility and drift of the historical net series.
   */
  async cashflowRisk(userId: string, w: Window = defaultRange()) {
    const cashflow = await this.analytics.cashflow(userId, w, 'month');
    const nets = cashflow.series.map((s) => s.net);

    const remote = await this.ml.call<{
      riskScore: number;
      probabilityNegative: number;
      drivers: string[];
      model: string;
    }>('/score/cashflow', { series: nets });

    if (remote) return { source: 'ml' as const, ...remote };

    const avg = nets.reduce((a, b) => a + b, 0) / Math.max(1, nets.length);
    const sd = Math.sqrt(
      nets.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, nets.length - 1),
    );
    // Normal approximation: P(next net < 0).
    const z = sd === 0 ? (avg < 0 ? -5 : 5) : -avg / sd;
    const probabilityNegative = roundTo(normalCdf(z) * 100, 1);
    const negativeMonths = nets.filter((n) => n < 0).length;

    const drivers: string[] = [];
    if (negativeMonths) drivers.push(`${negativeMonths} negative month(s) in the window`);
    if (sd > Math.abs(avg)) drivers.push('Net cash flow is more volatile than its own average');
    if (avg < 0) drivers.push('Average net cash flow is negative');

    return {
      source: 'fallback' as const,
      model: 'gaussian-approximation',
      riskScore: Math.round(Math.min(100, probabilityNegative)),
      probabilityNegative,
      drivers: drivers.length ? drivers : ['Cash flow is stable and positive'],
    };
  }

  /** Bulk auto-categorisation of everything still uncategorised. */
  async autoCategorizeUncategorised(userId: string, limit = 200) {
    const rows = await this.prisma.transaction.findMany({
      where: { userId, isDeleted: false, categoryId: null, type: { not: 'TRANSFER' } },
      select: { id: true, description: true, merchant: true, amountMinor: true },
      take: limit,
    });

    let updated = 0;
    const applied: { id: string; category: string; confidence: number }[] = [];

    for (const row of rows) {
      const prediction = await this.predictCategory(
        userId,
        `${row.description} ${row.merchant ?? ''}`.trim(),
        toMajor(row.amountMinor),
      );
      // Only commit confident predictions; the rest stay for human review.
      if (!prediction.categoryId || prediction.confidence < 0.6) continue;
      await this.prisma.transaction.update({
        where: { id: row.id },
        data: { categoryId: prediction.categoryId },
      });
      applied.push({
        id: row.id,
        category: prediction.categoryName,
        confidence: prediction.confidence,
      });
      updated++;
    }

    this.cache.invalidate(`analytics:${userId}`);
    return { candidates: rows.length, updated, skipped: rows.length - updated, applied };
  }

  /** Persists a prediction so the dashboard can read it without a round trip. */
  async cachePrediction(args: {
    userId?: string;
    orgId?: string;
    kind: string;
    subjectId?: string;
    payload: unknown;
    score?: number;
    modelName?: string;
  }) {
    return this.prisma.mlPrediction.create({
      data: {
        userId: args.userId ?? null,
        orgId: args.orgId ?? null,
        kind: args.kind,
        subjectId: args.subjectId ?? null,
        payload: JSON.stringify(args.payload),
        score: args.score ?? 0,
        modelName: args.modelName ?? 'baseline',
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Abramowitz-Stegun approximation of the standard normal CDF. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

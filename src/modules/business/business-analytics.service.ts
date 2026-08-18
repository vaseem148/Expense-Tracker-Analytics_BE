import { Injectable } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { Granularity } from 'src/common/types/domain.types';
import { daysBetween, defaultRange, previousPeriod, seasonalPeriod } from 'src/common/utils/date';
import { forecast } from 'src/common/utils/forecast';
import { pctChange, roundTo, share, toMajor } from 'src/common/utils/money';
import { gini, mean, sum } from 'src/common/utils/stats';
import { AnalyticsService } from '../analytics/analytics.service';
import { buildCategoryBreakdown, buildSeries } from '../analytics/engine/timeseries.engine';
import { LedgerRow } from '../analytics/engine/ledger.types';
import { OrgAccessService } from './org-access.service';

interface Window {
  from: Date;
  to: Date;
}

@Injectable()
export class BusinessAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: OrgAccessService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Org-wide ledger (every member), unlike the personal loader. */
  private async loadOrgLedger(orgId: string, w: Window): Promise<LedgerRow[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { orgId, isDeleted: false, date: { gte: w.from, lte: w.to } },
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

  /**
   * The board-level view: burn, runway, revenue, margin and headcount cost.
   * Runway is the number the whole thing exists to protect.
   */
  async kpis(orgId: string, userId: string, w: Window = defaultRange()) {
    await this.access.membership(orgId, userId);
    return this.cache.wrap(`analytics:org:${orgId}:kpis:${w.from.toISOString().slice(0, 10)}`, 45_000, async () => {
      const [rows, prevRows, org, headcount] = await Promise.all([
        this.loadOrgLedger(orgId, w),
        this.loadOrgLedger(orgId, previousPeriod(w.from, w.to)),
        this.prisma.organization.findUnique({ where: { id: orgId } }),
        this.prisma.orgMember.count({ where: { orgId, isActive: true } }),
      ]);

      const opex = sum(rows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));
      const revenue = sum(rows.filter((r) => r.type === 'INCOME').map((r) => r.amount));
      const prevOpex = sum(prevRows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));
      const prevRevenue = sum(prevRows.filter((r) => r.type === 'INCOME').map((r) => r.amount));
      const days = Math.max(1, daysBetween(w.from, w.to));
      const monthlyBurn = (opex / days) * 30;
      const netBurn = ((opex - revenue) / days) * 30;
      const cash = toMajor(org?.cashOnHandMinor ?? 0);

      return {
        currency: org?.currency ?? 'INR',
        period: { from: w.from.toISOString(), to: w.to.toISOString(), days },
        revenue: roundTo(revenue, 2),
        opex: roundTo(opex, 2),
        grossProfit: roundTo(revenue - opex, 2),
        margin: revenue > 0 ? roundTo(((revenue - opex) / revenue) * 100, 1) : null,
        monthlyBurn: roundTo(monthlyBurn, 2),
        netBurn: roundTo(netBurn, 2),
        cashOnHand: cash,
        // Infinity is meaningless in a UI, so a profitable org reports null.
        runwayMonths: netBurn > 0 && cash > 0 ? roundTo(cash / netBurn, 1) : null,
        headcount,
        costPerEmployee: headcount > 0 ? roundTo(opex / headcount, 2) : 0,
        billableSpend: roundTo(sum(rows.filter((r) => r.isBillable).map((r) => r.amount)), 2),
        taxPaid: roundTo(sum(rows.map((r) => r.taxAmount)), 2),
        transactions: rows.length,
        change: {
          opexPct: pctChange(prevOpex, opex),
          revenuePct: pctChange(prevRevenue, revenue),
        },
      };
    });
  }

  /** Profit & loss statement grouped by category, with a comparison column. */
  async profitAndLoss(orgId: string, userId: string, w: Window, g: Granularity = 'month') {
    await this.access.require(orgId, userId, 'FINANCE');
    const [rows, prevRows] = await Promise.all([
      this.loadOrgLedger(orgId, w),
      this.loadOrgLedger(orgId, previousPeriod(w.from, w.to)),
    ]);

    const income = buildCategoryBreakdown(rows, w.from, w.to, g, 'INCOME');
    const expense = buildCategoryBreakdown(rows, w.from, w.to, g, 'EXPENSE');
    const prevIncome = new Map(
      buildCategoryBreakdown(prevRows, w.from, w.to, g, 'INCOME').map((c) => [c.name, c.total]),
    );
    const prevExpense = new Map(
      buildCategoryBreakdown(prevRows, w.from, w.to, g, 'EXPENSE').map((c) => [c.name, c.total]),
    );

    const totalIncome = sum(income.map((i) => i.total));
    const totalExpense = sum(expense.map((e) => e.total));

    const line = (c: { name: string; color: string; total: number }, prev: Map<string, number>) => ({
      name: c.name,
      color: c.color,
      amount: c.total,
      previous: roundTo(prev.get(c.name) ?? 0, 2),
      changePct: pctChange(prev.get(c.name) ?? 0, c.total),
    });

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString() },
      revenue: { lines: income.map((c) => line(c, prevIncome)), total: roundTo(totalIncome, 2) },
      expenses: {
        lines: expense.map((c) => ({ ...line(c, prevExpense), share: share(c.total, totalExpense) })),
        total: roundTo(totalExpense, 2),
      },
      netProfit: roundTo(totalIncome - totalExpense, 2),
      netMargin: totalIncome > 0 ? roundTo(((totalIncome - totalExpense) / totalIncome) * 100, 1) : null,
      series: buildSeries(rows, w.from, w.to, g),
    };
  }

  /** Department budget vs actual, ranked by overspend risk. */
  async departments(orgId: string, userId: string, w: Window) {
    await this.access.membership(orgId, userId);
    const [departments, rows] = await Promise.all([
      this.prisma.department.findMany({
        where: { orgId },
        include: { _count: { select: { members: true } } },
      }),
      this.loadOrgLedger(orgId, w),
    ]);

    const months = Math.max(1, daysBetween(w.from, w.to) / 30);
    const totalSpend = sum(rows.filter((r) => r.type === 'EXPENSE').map((r) => r.amount));

    const items = departments.map((d) => {
      const dRows = rows.filter((r) => r.departmentId === d.id && r.type === 'EXPENSE');
      const spent = sum(dRows.map((r) => r.amount));
      const budget = toMajor(d.monthlyBudget) * months;
      const topCategory = buildCategoryBreakdown(dRows, w.from, w.to, 'month')[0];
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        color: d.color,
        headcount: d._count.members,
        budget: roundTo(budget, 2),
        spent: roundTo(spent, 2),
        variance: roundTo(budget - spent, 2),
        consumedPct: budget > 0 ? roundTo((spent / budget) * 100, 1) : null,
        share: share(spent, totalSpend),
        perHead: d._count.members > 0 ? roundTo(spent / d._count.members, 2) : 0,
        transactions: dRows.length,
        topCategory: topCategory ? { name: topCategory.name, total: topCategory.total } : null,
        status: budget === 0 ? 'no-budget' : spent > budget ? 'over' : spent > budget * 0.9 ? 'at-risk' : 'healthy',
      };
    });

    const unassigned = rows.filter((r) => r.type === 'EXPENSE' && !r.departmentId);
    return {
      items: items.sort((a, b) => b.spent - a.spent),
      unassigned: { total: roundTo(sum(unassigned.map((r) => r.amount)), 2), count: unassigned.length },
      totalBudget: roundTo(sum(items.map((i) => i.budget)), 2),
      totalSpent: roundTo(sum(items.map((i) => i.spent)), 2),
    };
  }

  /**
   * Vendor concentration. A Herfindahl-style read on supplier risk: if one
   * vendor owns most of the spend, losing them is an operational event.
   */
  async vendorAnalysis(orgId: string, userId: string, w: Window) {
    await this.access.membership(orgId, userId);
    const rows = (await this.loadOrgLedger(orgId, w)).filter(
      (r) => r.type === 'EXPENSE' && r.vendorId,
    );
    const groups = new Map<string, LedgerRow[]>();
    for (const r of rows) {
      const list = groups.get(r.vendorId!);
      if (list) list.push(r);
      else groups.set(r.vendorId!, [r]);
    }

    const total = sum(rows.map((r) => r.amount));
    const items = [...groups.entries()]
      .map(([vendorId, list]) => {
        const spend = sum(list.map((r) => r.amount));
        const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
        return {
          vendorId,
          name: list[0].vendorName ?? 'Unknown vendor',
          spend: roundTo(spend, 2),
          share: share(spend, total),
          transactions: list.length,
          averageTicket: roundTo(mean(list.map((r) => r.amount)), 2),
          firstSeen: sorted[0].date,
          lastSeen: sorted[sorted.length - 1].date,
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const top3Share = share(
      sum(items.slice(0, 3).map((i) => i.spend)),
      total,
    );

    return {
      items,
      totalVendorSpend: roundTo(total, 2),
      vendorCount: items.length,
      concentration: {
        gini: roundTo(gini(items.map((i) => i.spend)), 3),
        top1Share: items[0]?.share ?? 0,
        top3Share,
        risk: top3Share > 70 ? 'high' : top3Share > 50 ? 'moderate' : 'low',
      },
    };
  }

  /** GST/VAT position for a filing period, split by rate slab. */
  async taxSummary(orgId: string, userId: string, w: Window) {
    await this.access.require(orgId, userId, 'FINANCE');
    const rows = await this.prisma.transaction.findMany({
      where: { orgId, isDeleted: false, date: { gte: w.from, lte: w.to } },
      select: {
        type: true,
        amountMinor: true,
        taxAmountMinor: true,
        taxRateBps: true,
        vendor: { select: { name: true, gstin: true } },
      },
    });

    const slabs = new Map<number, { taxable: number; tax: number; count: number }>();
    for (const r of rows) {
      const slot = slabs.get(r.taxRateBps) ?? { taxable: 0, tax: 0, count: 0 };
      slot.taxable += toMajor(r.amountMinor - r.taxAmountMinor);
      slot.tax += toMajor(r.taxAmountMinor);
      slot.count++;
      slabs.set(r.taxRateBps, slot);
    }

    const inputCredit = sum(
      rows.filter((r) => r.type === 'EXPENSE').map((r) => toMajor(r.taxAmountMinor)),
    );
    const outputTax = sum(
      rows.filter((r) => r.type === 'INCOME').map((r) => toMajor(r.taxAmountMinor)),
    );

    return {
      period: { from: w.from.toISOString(), to: w.to.toISOString() },
      slabs: [...slabs.entries()]
        .map(([bps, v]) => ({
          ratePct: bps / 100,
          taxableValue: roundTo(v.taxable, 2),
          taxAmount: roundTo(v.tax, 2),
          transactions: v.count,
        }))
        .sort((a, b) => a.ratePct - b.ratePct),
      inputTaxCredit: roundTo(inputCredit, 2),
      outputTaxLiability: roundTo(outputTax, 2),
      netPayable: roundTo(outputTax - inputCredit, 2),
      // Missing vendor GSTINs are the usual reason input credit gets denied.
      missingVendorGstin: rows.filter((r) => r.type === 'EXPENSE' && r.vendor && !r.vendor.gstin)
        .length,
    };
  }

  /** Reimbursement pipeline health: volume, value and approval latency. */
  async claimsAnalytics(orgId: string, userId: string, w: Window) {
    await this.access.require(orgId, userId, 'MANAGER');
    const claims = await this.prisma.expenseClaim.findMany({
      where: { orgId, createdAt: { gte: w.from, lte: w.to } },
      include: { user: { select: { id: true, name: true } } },
    });

    const decided = claims.filter((c) => c.submittedAt && c.decidedAt);
    const latencies = decided.map(
      (c) => (c.decidedAt!.getTime() - c.submittedAt!.getTime()) / 3600_000,
    );

    const byClaimant = new Map<string, { name: string; count: number; total: number }>();
    for (const c of claims) {
      const slot = byClaimant.get(c.userId) ?? { name: c.user.name, count: 0, total: 0 };
      slot.count++;
      slot.total += toMajor(c.totalMinor);
      byClaimant.set(c.userId, slot);
    }

    return {
      total: claims.length,
      totalValue: roundTo(sum(claims.map((c) => toMajor(c.totalMinor))), 2),
      byStatus: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'].map((s) => ({
        status: s,
        count: claims.filter((c) => c.status === s).length,
        value: roundTo(
          sum(claims.filter((c) => c.status === s).map((c) => toMajor(c.totalMinor))),
          2,
        ),
      })),
      approvalLatencyHours: {
        average: roundTo(mean(latencies), 1),
        max: latencies.length ? roundTo(Math.max(...latencies), 1) : 0,
        decided: decided.length,
      },
      pendingOver48h: claims.filter(
        (c) => c.status === 'SUBMITTED' && c.submittedAt && Date.now() - c.submittedAt.getTime() > 48 * 3600_000,
      ).length,
      rejectionRate: decided.length
        ? roundTo((claims.filter((c) => c.status === 'REJECTED').length / decided.length) * 100, 1)
        : 0,
      topClaimants: [...byClaimant.values()].sort((a, b) => b.total - a.total).slice(0, 5),
      policyFlagged: claims.filter((c) => c.policyFlags).length,
    };
  }

  /** Cash-out projection: forecast plus already-committed invoice payments. */
  async cashflowForecast(orgId: string, userId: string, w: Window, g: Granularity = 'month') {
    await this.access.require(orgId, userId, 'FINANCE');
    const [rows, upcoming, org] = await Promise.all([
      this.loadOrgLedger(orgId, w),
      this.prisma.invoice.findMany({
        where: { orgId, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
        include: { vendor: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      this.prisma.organization.findUnique({ where: { id: orgId } }),
    ]);

    const series = buildSeries(rows, w.from, w.to, g);
    const outflowForecast = forecast(series.map((s) => s.expense), 3, seasonalPeriod(g));
    const inflowForecast = forecast(series.map((s) => s.income), 3, seasonalPeriod(g));

    const committed = upcoming.map((i) => ({
      invoiceId: i.id,
      number: i.number,
      vendor: i.vendor.name,
      dueDate: i.dueDate,
      amount: toMajor(i.totalMinor - i.paidMinor),
      daysToDue: Math.ceil((i.dueDate.getTime() - Date.now()) / 864e5),
    }));

    const cash = toMajor(org?.cashOnHandMinor ?? 0);
    let projectedCash = cash;
    const projection = outflowForecast.points.map((p, i) => {
      const inflow = inflowForecast.points[i]?.value ?? 0;
      projectedCash += inflow - p.value;
      return {
        period: i + 1,
        projectedOutflow: roundTo(p.value, 2),
        projectedInflow: roundTo(inflow, 2),
        projectedCash: roundTo(projectedCash, 2),
        lower: roundTo(p.lower, 2),
        upper: roundTo(p.upper, 2),
      };
    });

    return {
      series,
      projection,
      method: outflowForecast.method,
      confidence: outflowForecast.confidence,
      committedOutflow: {
        next30Days: roundTo(
          sum(committed.filter((c) => c.daysToDue <= 30).map((c) => c.amount)),
          2,
        ),
        total: roundTo(sum(committed.map((c) => c.amount)), 2),
        items: committed.slice(0, 10),
      },
      cashOnHand: cash,
      // The month the projection dips below zero, if it ever does.
      cashOutMonth: projection.findIndex((p) => p.projectedCash < 0) + 1 || null,
    };
  }

  /** Everything a business dashboard needs in one call. */
  async dashboard(orgId: string, userId: string, w: Window, g: Granularity = 'month') {
    const [kpis, departments, vendors, claims] = await Promise.all([
      this.kpis(orgId, userId, w),
      this.departments(orgId, userId, w),
      this.vendorAnalysis(orgId, userId, w),
      this.claimsAnalytics(orgId, userId, w).catch(() => null),
    ]);
    const rows = await this.loadOrgLedger(orgId, w);
    return {
      kpis,
      departments,
      vendors,
      claims,
      series: buildSeries(rows, w.from, w.to, g),
      categories: buildCategoryBreakdown(rows, w.from, w.to, g),
    };
  }
}

/**
 * Seeds a realistic 18-month ledger plus a full business workspace.
 * Everything is driven by a fixed PRNG seed so the demo data - and therefore
 * every screenshot, chart and test expectation - is reproducible.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_CATEGORIES } from '../src/modules/categories/default-categories';
import { normaliseMerchant, transactionHash } from '../src/common/utils/merchant';

const prisma = new PrismaClient();

let seed = 20260818;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => min + rnd() * (max - min);
const minor = (major: number) => Math.round(major * 100);

interface SpendProfile {
  category: string;
  merchants: string[];
  min: number;
  max: number;
  perMonth: number;
}

const PROFILES: SpendProfile[] = [
  { category: 'Groceries', merchants: ['BigBasket', 'DMart', 'Zepto', 'Reliance Fresh'], min: 450, max: 3200, perMonth: 7 },
  { category: 'Restaurants', merchants: ['Swiggy', 'Zomato', 'Dominos', 'Adyar Ananda Bhavan'], min: 180, max: 1400, perMonth: 9 },
  { category: 'Coffee', merchants: ['Starbucks', 'Third Wave Coffee', 'Chai Point'], min: 90, max: 480, perMonth: 6 },
  { category: 'Fuel', merchants: ['Indian Oil', 'HP Petrol Pump', 'Shell'], min: 800, max: 3500, perMonth: 3 },
  { category: 'Cab & Ride', merchants: ['Uber', 'Ola', 'Rapido'], min: 60, max: 780, perMonth: 8 },
  { category: 'Public Transit', merchants: ['Chennai Metro', 'IRCTC', 'RedBus'], min: 30, max: 1200, perMonth: 3 },
  { category: 'Pharmacy', merchants: ['Apollo Pharmacy', 'MedPlus', 'PharmEasy'], min: 120, max: 2200, perMonth: 2 },
  { category: 'Clothing', merchants: ['Myntra', 'Ajio', 'Zara', 'Westside'], min: 700, max: 6500, perMonth: 1 },
  { category: 'Shopping', merchants: ['Amazon', 'Flipkart', 'Nykaa'], min: 250, max: 9000, perMonth: 4 },
  { category: 'Electronics', merchants: ['Croma', 'Reliance Digital'], min: 1500, max: 45000, perMonth: 0.2 },
  { category: 'Events', merchants: ['BookMyShow', 'PVR Cinemas'], min: 250, max: 2400, perMonth: 1.5 },
  { category: 'Fitness', merchants: ['Cult Fit', 'Gold Gym'], min: 800, max: 2500, perMonth: 0.6 },
  { category: 'Travel', merchants: ['MakeMyTrip', 'IndiGo', 'OYO Rooms'], min: 2500, max: 32000, perMonth: 0.4 },
  { category: 'Gifts & Donations', merchants: ['Temple Trust', 'Ferns N Petals'], min: 300, max: 5000, perMonth: 0.8 },
  { category: 'Fees & Charges', merchants: ['HDFC Bank', 'Annual Card Fee'], min: 50, max: 900, perMonth: 1.2 },
];

const RECURRING = [
  { category: 'Rent', merchant: 'Landlord', amount: 24000, day: 3 },
  { category: 'Electricity', merchant: 'TNEB', amount: 1850, day: 8 },
  { category: 'Internet', merchant: 'ACT Fibernet', amount: 1199, day: 5 },
  { category: 'Mobile', merchant: 'Airtel', amount: 799, day: 12 },
  { category: 'Streaming', merchant: 'Netflix', amount: 649, day: 15 },
  { category: 'Streaming', merchant: 'Spotify', amount: 119, day: 18 },
  { category: 'Subscriptions', merchant: 'Google One', amount: 130, day: 22 },
  { category: 'Insurance', merchant: 'Star Health', amount: 2400, day: 25 },
];

const categoryIds = new Map<string, string>();
let demoId = '';
let analystId = '';
let salaryAccountId = '';
let creditCardId = '';

async function reset(): Promise<void> {
  await prisma.transactionTag.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.savingsGoal.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.expenseClaim.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.project.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.approvalPolicy.deleteMany();
  await prisma.orgMember.deleteMany();
  await prisma.department.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.mlPrediction.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUsersAndCategories(): Promise<void> {
  const passwordHash = await argon2.hash('Demo#1234', { type: argon2.argon2id });

  const demo = await prisma.user.create({
    data: {
      email: 'demo@expense.app',
      name: 'Mohamed Vaseem',
      passwordHash,
      role: 'ADMIN',
      currency: 'INR',
      locale: 'en-IN',
      monthlyIncome: minor(125000),
      avatarColor: '#6366f1',
    },
  });
  const analyst = await prisma.user.create({
    data: {
      email: 'analyst@expense.app',
      name: 'Priya Raman',
      passwordHash,
      currency: 'INR',
      monthlyIncome: minor(78000),
      avatarColor: '#f97316',
    },
  });
  demoId = demo.id;
  analystId = analyst.id;

  for (const [index, def] of DEFAULT_CATEGORIES.entries()) {
    const parent = await prisma.category.create({
      data: {
        userId: demoId,
        name: def.name,
        kind: def.kind,
        icon: def.icon,
        color: def.color,
        isSystem: true,
        sortOrder: index * 10,
      },
    });
    categoryIds.set(def.name, parent.id);
    for (const [ci, child] of (def.children ?? []).entries()) {
      const sub = await prisma.category.create({
        data: {
          userId: demoId,
          name: child,
          kind: def.kind,
          icon: def.icon,
          color: def.color,
          parentId: parent.id,
          isSystem: true,
          sortOrder: index * 10 + ci + 1,
        },
      });
      categoryIds.set(child, sub.id);
    }
    await prisma.category.create({
      data: {
        userId: analystId,
        name: def.name,
        kind: def.kind,
        icon: def.icon,
        color: def.color,
        isSystem: true,
        sortOrder: index * 10,
      },
    });
  }
}

async function seedLedger(): Promise<number> {
  const salary = await prisma.account.create({
    data: { userId: demoId, name: 'HDFC Salary', type: 'BANK', openingBalance: minor(85000), color: '#0ea5e9', icon: 'landmark' },
  });
  const card = await prisma.account.create({
    data: { userId: demoId, name: 'Amex Platinum', type: 'CREDIT_CARD', openingBalance: 0, creditLimit: minor(300000), color: '#8b5cf6', icon: 'credit-card' },
  });
  const wallet = await prisma.account.create({
    data: { userId: demoId, name: 'Paytm Wallet', type: 'WALLET', openingBalance: minor(4500), color: '#10b981', icon: 'wallet' },
  });
  const savings = await prisma.account.create({
    data: { userId: demoId, name: 'ICICI Savings', type: 'BANK', openingBalance: minor(240000), color: '#f59e0b', icon: 'piggy-bank' },
  });
  await prisma.account.create({
    data: { userId: analystId, name: 'Main Account', type: 'BANK', openingBalance: minor(30000) },
  });
  salaryAccountId = salary.id;
  creditCardId = card.id;

  const accounts = [salary.id, card.id, wallet.id];
  const rows: Record<string, unknown>[] = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 17, 1);

  for (let m = 0; m < 18; m++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    // Spending drifts up ~0.8%/month, with a festival bump in Oct/Nov.
    const drift = 1 + m * 0.008;
    const festive = [9, 10].includes(monthStart.getMonth()) ? 1.35 : 1;

    rows.push({
      userId: demoId,
      accountId: salary.id,
      categoryId: categoryIds.get('Salary'),
      type: 'INCOME',
      amountMinor: minor(125000 + Math.round(between(-2000, 6000))),
      description: 'Monthly salary credit',
      merchant: 'Acme Analytics Pvt Ltd',
      merchantKey: normaliseMerchant('Acme Analytics Pvt Ltd'),
      date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 1, 10, 0),
      paymentMethod: 'NETBANKING',
      isRecurring: true,
    });

    if (m % 4 === 2) {
      rows.push({
        userId: demoId,
        accountId: salary.id,
        categoryId: categoryIds.get('Freelance'),
        type: 'INCOME',
        amountMinor: minor(Math.round(between(18000, 65000))),
        description: 'Freelance dashboard build',
        merchant: 'Upwork',
        merchantKey: 'upwork',
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 14, 16, 0),
        paymentMethod: 'NETBANKING',
      });
    }

    for (const r of RECURRING) {
      const day = Math.min(r.day, daysInMonth);
      const variance = r.category === 'Electricity' ? between(0.8, 1.45) : 1;
      rows.push({
        userId: demoId,
        accountId: r.amount > 5000 ? salary.id : card.id,
        categoryId: categoryIds.get(r.category),
        type: 'EXPENSE',
        amountMinor: minor(Math.round(r.amount * variance)),
        description: `${r.merchant} - ${r.category.toLowerCase()}`,
        merchant: r.merchant,
        merchantKey: normaliseMerchant(r.merchant),
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 9, 30),
        paymentMethod: 'AUTO_DEBIT',
        isRecurring: true,
      });
    }

    for (const p of PROFILES) {
      const count = Math.round(p.perMonth * festive * (0.7 + rnd() * 0.6));
      for (let i = 0; i < count; i++) {
        const day = 1 + Math.floor(rnd() * daysInMonth);
        const merchant = pick(p.merchants);
        rows.push({
          userId: demoId,
          accountId: pick(accounts),
          categoryId: categoryIds.get(p.category),
          type: 'EXPENSE',
          amountMinor: minor(Math.round(between(p.min, p.max) * drift * festive)),
          description: `${merchant} purchase`,
          merchant,
          merchantKey: normaliseMerchant(merchant),
          date: new Date(
            monthStart.getFullYear(),
            monthStart.getMonth(),
            day,
            7 + Math.floor(rnd() * 15),
            Math.floor(rnd() * 60),
          ),
          paymentMethod: pick(['UPI', 'CARD', 'UPI', 'UPI', 'CASH']),
        });
      }
    }

    rows.push({
      userId: demoId,
      accountId: salary.id,
      toAccountId: savings.id,
      type: 'TRANSFER',
      amountMinor: minor(Math.round(between(10000, 25000))),
      description: 'Transfer to savings',
      date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 2, 11, 0),
      paymentMethod: 'NETBANKING',
    });
  }

  // Deliberate outliers so anomaly detection has something real to find.
  rows.push({
    userId: demoId,
    accountId: card.id,
    categoryId: categoryIds.get('Electronics'),
    type: 'EXPENSE',
    amountMinor: minor(142000),
    description: 'MacBook Pro 14 inch',
    merchant: 'Apple Store',
    merchantKey: 'apple store',
    date: new Date(now.getFullYear(), now.getMonth() - 1, 12, 15, 20),
    paymentMethod: 'CARD',
  });
  rows.push({
    userId: demoId,
    accountId: card.id,
    categoryId: categoryIds.get('Restaurants'),
    type: 'EXPENSE',
    amountMinor: minor(18600),
    description: 'Anniversary dinner',
    merchant: 'ITC Grand Chola',
    merchantKey: 'itc grand chola',
    date: new Date(now.getFullYear(), now.getMonth(), 6, 21, 15),
    paymentMethod: 'CARD',
  });

  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const hash = transactionHash({
      accountId: r.accountId as string,
      date: r.date as Date,
      amountMinor: r.amountMinor as number,
      description: r.description as string,
      type: r.type as string,
    });
    if (seen.has(hash)) return false;
    seen.add(hash);
    r.externalHash = hash;
    return true;
  });

  await prisma.transaction.createMany({ data: unique as never });
  return unique.length;
}

async function seedPlanning(): Promise<void> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Sized against the generated spend so the demo shows a realistic spread of
  // on-track, at-risk and exceeded rather than five red bars.
  const budgets = [
    { name: 'Monthly ceiling', amount: 145000, categoryId: null },
    { name: 'Food & Dining', amount: 46000, categoryId: categoryIds.get('Food & Dining') },
    { name: 'Shopping', amount: 26000, categoryId: categoryIds.get('Shopping') },
    { name: 'Transport', amount: 21000, categoryId: categoryIds.get('Transport') },
    { name: 'Entertainment', amount: 5000, categoryId: categoryIds.get('Entertainment') },
    { name: 'Health', amount: 9000, categoryId: categoryIds.get('Health') },
  ];
  for (const b of budgets) {
    await prisma.budget.create({
      data: {
        userId: demoId,
        name: b.name,
        amountMinor: minor(b.amount),
        categoryId: b.categoryId ?? null,
        period: 'MONTHLY',
        startDate: monthStart,
        alertThreshold: 0.8,
      },
    });
  }

  const goals = [
    { name: 'Emergency fund', target: 600000, saved: 385000, months: 8, color: '#10b981', icon: 'shield' },
    { name: 'Japan trip', target: 250000, saved: 92000, months: 11, color: '#f97316', icon: 'plane' },
    { name: 'New laptop', target: 180000, saved: 180000, months: 0, color: '#6366f1', icon: 'laptop' },
  ];
  for (const g of goals) {
    await prisma.savingsGoal.create({
      data: {
        userId: demoId,
        name: g.name,
        targetMinor: minor(g.target),
        savedMinor: minor(g.saved),
        targetDate: new Date(now.getFullYear(), now.getMonth() + g.months, 15),
        color: g.color,
        icon: g.icon,
        isAchieved: g.saved >= g.target,
      },
    });
  }

  for (const r of RECURRING) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(r.day, 28), 9, 30);
    await prisma.recurringRule.create({
      data: {
        userId: demoId,
        accountId: r.amount > 5000 ? salaryAccountId : creditCardId,
        categoryId: categoryIds.get(r.category) ?? null,
        amountMinor: minor(r.amount),
        description: `${r.merchant} - ${r.category.toLowerCase()}`,
        merchant: r.merchant,
        frequency: 'MONTHLY',
        dayOfMonth: r.day,
        startDate: new Date(now.getFullYear() - 1, 0, r.day),
        nextRunAt: next,
        lastRunAt: new Date(now.getFullYear(), now.getMonth(), Math.min(r.day, 28)),
      },
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        userId: demoId,
        type: 'BUDGET_ALERT',
        severity: 'warning',
        title: 'Shopping budget at 87%',
        body: 'You have 13% of the Shopping budget left with 9 days to go.',
      },
      {
        userId: demoId,
        type: 'ANOMALY',
        severity: 'critical',
        title: 'Unusual transaction detected',
        body: 'Apple Store 1,42,000 is far above your usual Electronics spend.',
      },
      {
        userId: demoId,
        type: 'GOAL_REACHED',
        severity: 'success',
        title: 'Goal reached: New laptop',
        body: 'You hit your 1,80,000 target. Time to spend it.',
        isRead: true,
      },
    ],
  });
}

const VENDOR_SPECS = [
  { name: 'Amazon Web Services', category: 'Cloud infrastructure', gstin: '29AACCA1234M1Z5', terms: 30, dept: 'ENG', monthly: 185000 },
  { name: 'Zoho Corporation', category: 'Software licences', gstin: '33AAACZ1234A1Z1', terms: 30, dept: 'SLS', monthly: 42000 },
  { name: 'WeWork India', category: 'Office space', gstin: '33AABCW5678K1ZP', terms: 15, dept: 'OPS', monthly: 220000 },
  { name: 'Freshworks', category: 'Support tooling', gstin: '33AAACF9876Q1ZR', terms: 45, dept: 'SLS', monthly: 28000 },
  { name: 'Airtel Business', category: 'Connectivity', gstin: '33AAACB2894G1ZX', terms: 30, dept: 'OPS', monthly: 34000 },
  { name: 'IndiGo Airlines', category: 'Travel', gstin: null, terms: 7, dept: 'SLS', monthly: 96000 },
  { name: 'Chennai Catering Co', category: 'Facilities', gstin: null, terms: 15, dept: 'GNA', monthly: 38000 },
  { name: 'Deloitte India', category: 'Professional services', gstin: '27AABCD3245P1ZQ', terms: 60, dept: 'GNA', monthly: 150000 },
];

async function seedOrg(): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: 'Vaseem Technologies',
      slug: 'vaseem-technologies',
      legalName: 'Vaseem Technologies Private Limited',
      gstin: '33AABCU9603R1ZM',
      pan: 'AABCU9603R',
      city: 'Chennai',
      state: 'Tamil Nadu',
      currency: 'INR',
      fiscalYearStartMonth: 4,
      cashOnHandMinor: minor(4200000),
      logoColor: '#6366f1',
      ownerId: demoId,
      members: {
        create: [
          { userId: demoId, role: 'OWNER', title: 'Founder', monthlyLimit: minor(200000) },
          { userId: analystId, role: 'FINANCE', title: 'Finance Analyst', monthlyLimit: minor(60000) },
        ],
      },
      departments: {
        create: [
          { name: 'Engineering', code: 'ENG', monthlyBudget: minor(850000), color: '#0ea5e9' },
          { name: 'Sales & Marketing', code: 'SLS', monthlyBudget: minor(420000), color: '#f97316' },
          { name: 'Operations', code: 'OPS', monthlyBudget: minor(260000), color: '#10b981' },
          { name: 'General & Admin', code: 'GNA', monthlyBudget: minor(180000), color: '#64748b' },
        ],
      },
      policies: {
        create: [
          { name: 'Standard approval', minAmount: 0, maxAmount: minor(25000), approverRole: 'MANAGER', receiptAbove: minor(1000) },
          { name: 'Senior approval', minAmount: minor(25000), approverRole: 'FINANCE', requiresTwo: true, receiptAbove: minor(1000) },
          { name: 'Petty cash auto-approve', minAmount: 0, maxAmount: minor(2000), approverRole: 'MANAGER', autoApprove: true, receiptAbove: minor(5000) },
        ],
      },
    },
    include: { departments: true },
  });
  return org.id;
}

async function seedBusinessData(orgId: string): Promise<void> {
  const now = new Date();
  const departments = await prisma.department.findMany({ where: { orgId } });
  const deptByCode = new Map(departments.map((d) => [d.code, d.id]));

  const vendors = [];
  for (const v of VENDOR_SPECS) {
    vendors.push(
      await prisma.vendor.create({
        data: {
          orgId,
          name: v.name,
          normKey: normaliseMerchant(v.name) ?? v.name.toLowerCase(),
          gstin: v.gstin,
          category: v.category,
          paymentTermsDays: v.terms,
          isPreferred: v.monthly > 100000,
          email: `ap@${v.name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        },
      }),
    );
  }

  const projectA = await prisma.project.create({
    data: {
      orgId,
      name: 'Apollo Platform Migration',
      code: 'APL',
      clientName: 'Apollo Retail',
      budgetMinor: minor(2400000),
      startDate: new Date(now.getFullYear(), now.getMonth() - 6, 1),
      isBillable: true,
    },
  });
  await prisma.project.create({
    data: {
      orgId,
      name: 'Internal Data Warehouse',
      code: 'IDW',
      budgetMinor: minor(900000),
      startDate: new Date(now.getFullYear(), now.getMonth() - 3, 1),
      isBillable: false,
    },
  });

  const orgRows: Record<string, unknown>[] = [];
  for (let m = 11; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    for (const [index, v] of VENDOR_SPECS.entries()) {
      const base = v.monthly * between(0.82, 1.24);
      const taxRate = v.category === 'Travel' ? 5 : 18;
      const tax = Math.round(base * (taxRate / 100));
      orgRows.push({
        userId: demoId,
        orgId,
        accountId: salaryAccountId,
        vendorId: vendors[index].id,
        departmentId: deptByCode.get(v.dept),
        projectId: v.dept === 'ENG' ? projectA.id : null,
        scope: 'BUSINESS',
        type: 'EXPENSE',
        amountMinor: minor(Math.round(base + tax)),
        taxAmountMinor: minor(tax),
        taxRateBps: taxRate * 100,
        isBillable: v.dept === 'ENG',
        description: `${v.name} - ${v.category.toLowerCase()}`,
        merchant: v.name,
        merchantKey: normaliseMerchant(v.name),
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 5 + Math.floor(rnd() * 20), 11, 0),
        paymentMethod: 'NETBANKING',
      });
    }
    orgRows.push({
      userId: demoId,
      orgId,
      accountId: salaryAccountId,
      scope: 'BUSINESS',
      type: 'INCOME',
      amountMinor: minor(Math.round(between(1400000, 2350000))),
      taxAmountMinor: minor(Math.round(between(250000, 420000))),
      taxRateBps: 1800,
      description: 'Client retainer invoice settled',
      merchant: 'Apollo Retail',
      merchantKey: 'apollo retail',
      date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 10, 12, 0),
      paymentMethod: 'NETBANKING',
    });
  }

  const seen = new Set<string>();
  const unique = orgRows.filter((r) => {
    const hash = transactionHash({
      accountId: r.accountId as string,
      date: r.date as Date,
      amountMinor: r.amountMinor as number,
      description: r.description as string,
      type: r.type as string,
    });
    if (seen.has(hash)) return false;
    seen.add(hash);
    r.externalHash = hash;
    return true;
  });
  await prisma.transaction.createMany({ data: unique as never });
}

async function seedApAndClaims(orgId: string): Promise<void> {
  const vendors = await prisma.vendor.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });

  // Accounts payable spread across every aging bucket.
  const invoiceSpecs = [
    { vendor: 0, days: -8, subtotal: 185000, paid: 0, status: 'OPEN' },
    { vendor: 2, days: -40, subtotal: 220000, paid: 100000, status: 'PARTIAL' },
    { vendor: 5, days: 6, subtotal: 96000, paid: 0, status: 'OPEN' },
    { vendor: 7, days: -75, subtotal: 150000, paid: 0, status: 'OVERDUE' },
    { vendor: 1, days: 18, subtotal: 42000, paid: -1, status: 'PAID' },
    { vendor: 4, days: -3, subtotal: 34000, paid: 0, status: 'OPEN' },
  ];
  for (const [i, spec] of invoiceSpecs.entries()) {
    const tax = Math.round(spec.subtotal * 0.18);
    const total = spec.subtotal + tax;
    await prisma.invoice.create({
      data: {
        orgId,
        vendorId: vendors[spec.vendor].id,
        number: `INV-2026-${String(1001 + i)}`,
        issueDate: new Date(Date.now() - (30 - spec.days) * 864e5),
        dueDate: new Date(Date.now() + spec.days * 864e5),
        subtotalMinor: minor(spec.subtotal),
        taxMinor: minor(tax),
        totalMinor: minor(total),
        paidMinor: minor(spec.paid < 0 ? total : spec.paid),
        status: spec.status,
      },
    });
  }

  const claimSpecs = [
    { title: 'Client visit - Bengaluru', status: 'SUBMITTED', total: 18400, mine: false },
    { title: 'Team offsite catering', status: 'APPROVED', total: 42000, mine: true },
    { title: 'Conference tickets', status: 'REIMBURSED', total: 26500, mine: false },
    { title: 'Laptop accessories', status: 'DRAFT', total: 7300, mine: true },
    { title: 'Cab reimbursements - July', status: 'REJECTED', total: 5100, mine: false },
  ];
  for (const c of claimSpecs) {
    const decided = ['APPROVED', 'REJECTED', 'REIMBURSED'].includes(c.status);
    await prisma.expenseClaim.create({
      data: {
        orgId,
        userId: c.mine ? demoId : analystId,
        title: c.title,
        status: c.status,
        totalMinor: minor(c.total),
        submittedAt: c.status !== 'DRAFT' ? new Date(Date.now() - between(3, 20) * 864e5) : null,
        decidedAt: decided ? new Date(Date.now() - between(1, 3) * 864e5) : null,
        decidedById: decided ? demoId : null,
        reimbursedAt: c.status === 'REIMBURSED' ? new Date(Date.now() - 864e5) : null,
        decisionNote: c.status === 'REJECTED' ? 'Receipts missing for two entries' : null,
        policyFlags: c.status === 'SUBMITTED' ? JSON.stringify(['RECEIPT_MISSING:1']) : null,
      },
    });
  }

  await prisma.integration.createMany({
    data: [
      {
        orgId,
        provider: 'ZOHO_BOOKS',
        displayName: 'Zoho Books (sandbox)',
        status: 'CONNECTED',
        mode: 'SANDBOX',
        config: JSON.stringify({ region: 'in', accountId: 'expenses-default' }),
        scopes: JSON.stringify(['PULL', 'PUSH']),
        lastSyncAt: new Date(Date.now() - 3 * 3600_000),
      },
      {
        orgId,
        provider: 'SLACK',
        displayName: 'Finance alerts channel',
        status: 'CONNECTED',
        mode: 'SANDBOX',
        config: JSON.stringify({ channel: '#finance-alerts', mentionOnBreach: true }),
        scopes: JSON.stringify(['NOTIFY']),
      },
    ],
  });
}

async function main(): Promise<void> {
  console.log('Resetting database...');
  await reset();
  console.log('Seeding users and categories...');
  await seedUsersAndCategories();
  console.log('Generating 18 months of personal transactions...');
  console.log(`  ${await seedLedger()} transactions`);
  console.log('Seeding budgets, goals and recurring rules...');
  await seedPlanning();
  console.log('Seeding business workspace...');
  const orgId = await seedOrg();
  await seedBusinessData(orgId);
  await seedApAndClaims(orgId);
  console.log('');
  console.log('Seed complete.');
  console.log('  demo@expense.app    / Demo#1234   (ADMIN, org OWNER)');
  console.log('  analyst@expense.app / Demo#1234   (org FINANCE)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

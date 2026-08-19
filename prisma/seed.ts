/**
 * Seeds a company workspace: 18 months of operating spend and revenue across
 * departments, vendors and projects, plus the team, budgets, subscriptions,
 * payables and claims a finance lead would expect to find.
 *
 * A fixed PRNG seed keeps the data reproducible, so screenshots, charts and
 * test expectations do not drift between runs.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_CATEGORIES } from '../src/modules/categories/default-categories';
import { normaliseMerchant, transactionHash } from '../src/common/utils/merchant';

const prisma = new PrismaClient();

let seed = 20260819;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => min + rnd() * (max - min);
const minor = (major: number) => Math.round(major * 100);

interface Person {
  email: string;
  name: string;
  role: string;
  title: string;
  dept: string;
  limit: number;
  colour: string;
}

const TEAM: Person[] = [
  { email: 'demo@expense.app', name: 'Mohamed Vaseem', role: 'OWNER', title: 'Founder', dept: 'GNA', limit: 300000, colour: '#6366f1' },
  { email: 'analyst@expense.app', name: 'Priya Raman', role: 'FINANCE', title: 'Finance Lead', dept: 'GNA', limit: 120000, colour: '#f97316' },
  { email: 'arjun@expense.app', name: 'Arjun Nair', role: 'MANAGER', title: 'Engineering Manager', dept: 'ENG', limit: 90000, colour: '#0ea5e9' },
  { email: 'divya@expense.app', name: 'Divya Krishnan', role: 'MANAGER', title: 'Head of Sales', dept: 'SLS', limit: 90000, colour: '#10b981' },
  { email: 'karthik@expense.app', name: 'Karthik Subramanian', role: 'EMPLOYEE', title: 'Senior Engineer', dept: 'ENG', limit: 25000, colour: '#8b5cf6' },
  { email: 'sneha@expense.app', name: 'Sneha Iyer', role: 'EMPLOYEE', title: 'Account Executive', dept: 'SLS', limit: 25000, colour: '#e87ba4' },
  { email: 'rahul@expense.app', name: 'Rahul Menon', role: 'EMPLOYEE', title: 'Operations Analyst', dept: 'OPS', limit: 20000, colour: '#eda100' },
];

interface VendorSpec {
  name: string;
  category: string;
  gstin: string | null;
  terms: number;
  dept: string;
  monthly: number;
  costCategory: string;
  taxPct: number;
}

const VENDORS: VendorSpec[] = [
  { name: 'Amazon Web Services', category: 'Cloud infrastructure', gstin: '29AACCA1234M1Z5', terms: 30, dept: 'ENG', monthly: 185000, costCategory: 'Subscriptions', taxPct: 18 },
  { name: 'Zoho Corporation', category: 'Software licences', gstin: '33AAACZ1234A1Z1', terms: 30, dept: 'SLS', monthly: 42000, costCategory: 'Subscriptions', taxPct: 18 },
  { name: 'WeWork India', category: 'Office space', gstin: '33AABCW5678K1ZP', terms: 15, dept: 'OPS', monthly: 220000, costCategory: 'Rent', taxPct: 18 },
  { name: 'Freshworks', category: 'Support tooling', gstin: '33AAACF9876Q1ZR', terms: 45, dept: 'SLS', monthly: 28000, costCategory: 'Subscriptions', taxPct: 18 },
  { name: 'Airtel Business', category: 'Connectivity', gstin: '33AAACB2894G1ZX', terms: 30, dept: 'OPS', monthly: 34000, costCategory: 'Internet', taxPct: 18 },
  { name: 'IndiGo Airlines', category: 'Travel', gstin: null, terms: 7, dept: 'SLS', monthly: 96000, costCategory: 'Travel', taxPct: 5 },
  { name: 'Chennai Catering Co', category: 'Facilities', gstin: null, terms: 15, dept: 'GNA', monthly: 38000, costCategory: 'Food & Dining', taxPct: 5 },
  { name: 'Deloitte India', category: 'Professional services', gstin: '27AABCD3245P1ZQ', terms: 60, dept: 'GNA', monthly: 150000, costCategory: 'Fees & Charges', taxPct: 18 },
  { name: 'LinkedIn Talent', category: 'Recruiting', gstin: '27AAACL7896R1ZK', terms: 30, dept: 'GNA', monthly: 64000, costCategory: 'Subscriptions', taxPct: 18 },
  { name: 'Google Workspace', category: 'Productivity', gstin: '29AACCG0527D1Z8', terms: 30, dept: 'OPS', monthly: 26000, costCategory: 'Subscriptions', taxPct: 18 },
];

const state = {
  categoryIds: new Map<string, string>(),
  userIds: new Map<string, string>(),
  deptIds: new Map<string, string>(),
  orgId: '',
  accountId: '',
  cardId: '',
};

async function reset(): Promise<void> {
  await prisma.transactionTag.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.expenseClaim.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.project.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.approvalPolicy.deleteMany();
  await prisma.orgMember.deleteMany();
  await prisma.department.deleteMany();
  await prisma.syncRun.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.mlPrediction.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

async function seedTeam(): Promise<void> {
  const passwordHash = await argon2.hash('Demo#1234', { type: argon2.argon2id });

  for (const person of TEAM) {
    const user = await prisma.user.create({
      data: {
        email: person.email,
        name: person.name,
        passwordHash,
        role: person.role === 'OWNER' ? 'ADMIN' : 'USER',
        currency: 'INR',
        locale: 'en-IN',
        avatarColor: person.colour,
      },
    });
    state.userIds.set(person.email, user.id);
  }

  // Cost categories hang off the owner, who is the account the company data
  // is written against.
  const ownerId = state.userIds.get('demo@expense.app')!;
  for (const [index, def] of DEFAULT_CATEGORIES.entries()) {
    const parent = await prisma.category.create({
      data: {
        userId: ownerId,
        name: def.name,
        kind: def.kind,
        icon: def.icon,
        color: def.color,
        isSystem: true,
        sortOrder: index * 10,
      },
    });
    state.categoryIds.set(def.name, parent.id);
    for (const [ci, child] of (def.children ?? []).entries()) {
      const sub = await prisma.category.create({
        data: {
          userId: ownerId,
          name: child,
          kind: def.kind,
          icon: def.icon,
          color: def.color,
          parentId: parent.id,
          isSystem: true,
          sortOrder: index * 10 + ci + 1,
        },
      });
      state.categoryIds.set(child, sub.id);
    }
  }
}

async function seedOrg(): Promise<void> {
  const ownerId = state.userIds.get('demo@expense.app')!;

  const org = await prisma.organization.create({
    data: {
      name: 'Vaseem Technologies',
      slug: 'vaseem-technologies',
      legalName: 'Vaseem Technologies Private Limited',
      gstin: '33AABCU9603R1ZM',
      pan: 'AABCU9603R',
      addressLine: 'Tidel Park, Taramani',
      city: 'Chennai',
      state: 'Tamil Nadu',
      currency: 'INR',
      fiscalYearStartMonth: 4,
      cashOnHandMinor: minor(9800000),
      logoColor: '#6366f1',
      ownerId,
      departments: {
        create: [
          { name: 'Engineering', code: 'ENG', monthlyBudget: minor(320000), color: '#0ea5e9' },
          { name: 'Sales & Marketing', code: 'SLS', monthlyBudget: minor(210000), color: '#f97316' },
          { name: 'Operations', code: 'OPS', monthlyBudget: minor(300000), color: '#10b981' },
          { name: 'General & Admin', code: 'GNA', monthlyBudget: minor(280000), color: '#64748b' },
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

  state.orgId = org.id;
  for (const d of org.departments) state.deptIds.set(d.code, d.id);

  for (const person of TEAM) {
    await prisma.orgMember.create({
      data: {
        orgId: org.id,
        userId: state.userIds.get(person.email)!,
        role: person.role,
        title: person.title,
        departmentId: state.deptIds.get(person.dept)!,
        monthlyLimit: minor(person.limit),
      },
    });
  }

  const operating = await prisma.account.create({
    data: { userId: ownerId, name: 'HDFC Current Account', type: 'BANK', openingBalance: minor(9800000), color: '#0ea5e9', icon: 'landmark' },
  });
  const card = await prisma.account.create({
    data: { userId: ownerId, name: 'Corporate Amex', type: 'CREDIT_CARD', openingBalance: 0, creditLimit: minor(2000000), color: '#8b5cf6', icon: 'credit-card' },
  });
  state.accountId = operating.id;
  state.cardId = card.id;
}

const TEAM_SPEND = [
  { category: 'Cab & Ride', merchants: ['Uber', 'Ola'], min: 180, max: 1400, perMonth: 9 },
  { category: 'Restaurants', merchants: ['Swiggy Corporate', 'Zomato Business'], min: 600, max: 4200, perMonth: 5 },
  { category: 'Public Transit', merchants: ['IRCTC', 'Chennai Metro'], min: 120, max: 2600, perMonth: 3 },
  { category: 'Electronics', merchants: ['Croma', 'Reliance Digital'], min: 4000, max: 92000, perMonth: 0.7 },
  { category: 'Travel', merchants: ['MakeMyTrip', 'OYO Rooms'], min: 3500, max: 38000, perMonth: 1.2 },
  { category: 'Education', merchants: ['Udemy Business', 'Coursera'], min: 1500, max: 24000, perMonth: 0.8 },
];

async function seedCompanyRecords(): Promise<{ vendors: Map<string, string>; apollo: string; warehouse: string }> {
  const vendors = new Map<string, string>();
  for (const v of VENDORS) {
    const created = await prisma.vendor.create({
      data: {
        orgId: state.orgId,
        name: v.name,
        normKey: normaliseMerchant(v.name) ?? v.name.toLowerCase(),
        gstin: v.gstin,
        category: v.category,
        paymentTermsDays: v.terms,
        isPreferred: v.monthly > 100000,
        email: `ap@${v.name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      },
    });
    vendors.set(v.name, created.id);
  }

  const now = new Date();
  const apollo = await prisma.project.create({
    data: {
      orgId: state.orgId,
      name: 'Apollo Platform Migration',
      code: 'APL',
      clientName: 'Apollo Retail',
      budgetMinor: minor(4200000),
      startDate: new Date(now.getFullYear(), now.getMonth() - 8, 1),
      isBillable: true,
    },
  });
  const warehouse = await prisma.project.create({
    data: {
      orgId: state.orgId,
      name: 'Internal Data Warehouse',
      code: 'IDW',
      budgetMinor: minor(1400000),
      startDate: new Date(now.getFullYear(), now.getMonth() - 4, 1),
      isBillable: false,
    },
  });

  return { vendors, apollo: apollo.id, warehouse: warehouse.id };
}

async function seedLedger(refs: {
  vendors: Map<string, string>;
  apollo: string;
  warehouse: string;
}): Promise<number> {
  const ownerId = state.userIds.get('demo@expense.app')!;
  const rows: Record<string, unknown>[] = [];
  const now = new Date();

  for (let m = 17; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    // The company grows: the cost base drifts up about 1.2% a month.
    const growth = 1 + (17 - m) * 0.012;

    for (const v of VENDORS) {
      const gross = v.monthly * growth * between(0.86, 1.18);
      // GST is quoted inclusive on Indian invoices, so back the component out.
      const tax = Math.round(gross - gross / (1 + v.taxPct / 100));
      rows.push({
        userId: ownerId,
        orgId: state.orgId,
        accountId: state.accountId,
        vendorId: refs.vendors.get(v.name),
        departmentId: state.deptIds.get(v.dept),
        projectId: v.dept === 'ENG' ? refs.apollo : null,
        categoryId: state.categoryIds.get(v.costCategory) ?? null,
        scope: 'BUSINESS',
        type: 'EXPENSE',
        amountMinor: minor(Math.round(gross)),
        taxAmountMinor: minor(tax),
        taxRateBps: v.taxPct * 100,
        isBillable: v.dept === 'ENG',
        description: `${v.name} - ${v.category.toLowerCase()}`,
        merchant: v.name,
        merchantKey: normaliseMerchant(v.name),
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 3 + Math.floor(rnd() * 18), 11, 0),
        paymentMethod: 'NETBANKING',
        isRecurring: true,
      });
    }

    rows.push({
      userId: ownerId,
      orgId: state.orgId,
      accountId: state.accountId,
      departmentId: state.deptIds.get('GNA'),
      categoryId: state.categoryIds.get('Salary') ?? null,
      scope: 'BUSINESS',
      type: 'EXPENSE',
      amountMinor: minor(Math.round(1250000 * growth * between(0.98, 1.04))),
      description: 'Monthly payroll',
      merchant: 'Payroll',
      merchantKey: 'payroll',
      date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 1, 10, 0),
      paymentMethod: 'NETBANKING',
      isRecurring: true,
    });

    for (const profile of TEAM_SPEND) {
      const count = Math.round(profile.perMonth * (0.7 + rnd() * 0.7));
      for (let i = 0; i < count; i++) {
        const person = pick(TEAM.slice(2));
        const merchant = pick(profile.merchants);
        rows.push({
          userId: state.userIds.get(person.email)!,
          orgId: state.orgId,
          accountId: state.cardId,
          departmentId: state.deptIds.get(person.dept),
          projectId: person.dept === 'ENG' && rnd() > 0.5 ? refs.warehouse : null,
          categoryId: state.categoryIds.get(profile.category) ?? null,
          scope: 'BUSINESS',
          type: 'EXPENSE',
          amountMinor: minor(Math.round(between(profile.min, profile.max) * growth)),
          description: `${merchant} - ${person.name.split(' ')[0]}`,
          merchant,
          merchantKey: normaliseMerchant(merchant),
          date: new Date(
            monthStart.getFullYear(),
            monthStart.getMonth(),
            1 + Math.floor(rnd() * daysInMonth),
            9 + Math.floor(rnd() * 10),
            Math.floor(rnd() * 60),
          ),
          paymentMethod: pick(['CARD', 'UPI', 'CARD']),
          isReimbursable: true,
        });
      }
    }

    const revenue = 2650000 * growth * between(0.9, 1.16);
    rows.push({
      userId: ownerId,
      orgId: state.orgId,
      accountId: state.accountId,
      categoryId: state.categoryIds.get('Freelance') ?? null,
      scope: 'BUSINESS',
      type: 'INCOME',
      amountMinor: minor(Math.round(revenue)),
      taxAmountMinor: minor(Math.round(revenue - revenue / 1.18)),
      taxRateBps: 1800,
      description: 'Apollo Retail - monthly retainer',
      merchant: 'Apollo Retail',
      merchantKey: 'apollo retail',
      date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 8, 12, 0),
      paymentMethod: 'NETBANKING',
    });

    if (m % 3 === 1) {
      const milestone = 1400000 * growth * between(0.8, 1.3);
      rows.push({
        userId: ownerId,
        orgId: state.orgId,
        accountId: state.accountId,
        categoryId: state.categoryIds.get('Freelance') ?? null,
        scope: 'BUSINESS',
        type: 'INCOME',
        amountMinor: minor(Math.round(milestone)),
        taxAmountMinor: minor(Math.round(milestone - milestone / 1.18)),
        taxRateBps: 1800,
        description: 'Project milestone invoice settled',
        merchant: 'Northwind Logistics',
        merchantKey: 'northwind logistics',
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), 21, 12, 0),
        paymentMethod: 'NETBANKING',
      });
    }
  }

  // A deliberate outlier so anomaly detection has something real to surface.
  rows.push({
    userId: state.userIds.get('karthik@expense.app')!,
    orgId: state.orgId,
    accountId: state.cardId,
    departmentId: state.deptIds.get('ENG'),
    categoryId: state.categoryIds.get('Electronics') ?? null,
    scope: 'BUSINESS',
    type: 'EXPENSE',
    amountMinor: minor(486000),
    description: 'Workstation refresh - 3 machines',
    merchant: 'Apple Store',
    merchantKey: 'apple store',
    date: new Date(now.getFullYear(), now.getMonth() - 1, 12, 15, 20),
    paymentMethod: 'CARD',
    isReimbursable: true,
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

async function seedPlanning(refs: { vendors: Map<string, string> }): Promise<void> {
  const ownerId = state.userIds.get('demo@expense.app')!;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Sized against generated spend so the demo shows a realistic mix of
  // on-track, at-risk and exceeded rather than a wall of red.
  const budgets: { name: string; amount: number; categoryId?: string; departmentId?: string }[] = [
    { name: 'Company operating ceiling', amount: 3600000 },
    { name: 'Software & subscriptions', amount: 420000, categoryId: state.categoryIds.get('Subscriptions') },
    { name: 'Travel', amount: 165000, categoryId: state.categoryIds.get('Travel') },
    { name: 'Engineering cost centre', amount: 340000, departmentId: state.deptIds.get('ENG') },
    { name: 'Sales & Marketing cost centre', amount: 230000, departmentId: state.deptIds.get('SLS') },
    { name: 'Professional services', amount: 190000, categoryId: state.categoryIds.get('Fees & Charges') },
  ];

  for (const b of budgets) {
    await prisma.budget.create({
      data: {
        userId: ownerId,
        orgId: state.orgId,
        name: b.name,
        amountMinor: minor(b.amount),
        categoryId: b.categoryId ?? null,
        departmentId: b.departmentId ?? null,
        period: 'MONTHLY',
        startDate: monthStart,
        alertThreshold: 0.8,
      },
    });
  }

  // Declared subscriptions: the fixed cost base a CFO wants visible.
  const subscriptions = VENDORS.filter((v) => v.costCategory === 'Subscriptions' || v.costCategory === 'Rent');
  for (const [i, v] of subscriptions.entries()) {
    const day = 3 + i * 3;
    await prisma.recurringRule.create({
      data: {
        userId: ownerId,
        accountId: state.accountId,
        categoryId: state.categoryIds.get(v.costCategory) ?? null,
        amountMinor: minor(v.monthly),
        description: `${v.name} - ${v.category.toLowerCase()}`,
        merchant: v.name,
        frequency: 'MONTHLY',
        dayOfMonth: day,
        startDate: new Date(now.getFullYear() - 1, 0, day),
        nextRunAt: new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28), 9, 30),
        lastRunAt: new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28)),
      },
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        userId: ownerId,
        type: 'BUDGET_ALERT',
        severity: 'warning',
        title: 'Software & subscriptions at 91%',
        body: 'Nine days left in the period with 9% of the cap remaining.',
      },
      {
        userId: ownerId,
        type: 'ANOMALY',
        severity: 'critical',
        title: 'Unusual spend detected',
        body: 'Apple Store 4,86,000 is far above the usual Electronics ticket for Engineering.',
      },
      {
        userId: ownerId,
        type: 'DIGEST',
        severity: 'info',
        title: 'Two invoices due this week',
        body: 'WeWork India and Airtel Business fall due within seven days.',
        isRead: true,
      },
    ],
  });

  // Accounts payable across every aging bucket.
  const invoiceSpecs = [
    { vendor: 'Amazon Web Services', days: -8, subtotal: 185000, paid: 0, status: 'OPEN' },
    { vendor: 'WeWork India', days: -40, subtotal: 220000, paid: 100000, status: 'PARTIAL' },
    { vendor: 'IndiGo Airlines', days: 6, subtotal: 96000, paid: 0, status: 'OPEN' },
    { vendor: 'Deloitte India', days: -75, subtotal: 150000, paid: 0, status: 'OVERDUE' },
    { vendor: 'Zoho Corporation', days: 18, subtotal: 42000, paid: -1, status: 'PAID' },
    { vendor: 'Airtel Business', days: -3, subtotal: 34000, paid: 0, status: 'OPEN' },
    { vendor: 'LinkedIn Talent', days: 12, subtotal: 64000, paid: 0, status: 'OPEN' },
  ];
  for (const [i, spec] of invoiceSpecs.entries()) {
    const tax = Math.round(spec.subtotal * 0.18);
    const total = spec.subtotal + tax;
    await prisma.invoice.create({
      data: {
        orgId: state.orgId,
        vendorId: refs.vendors.get(spec.vendor)!,
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

  const claims = [
    { title: 'Client visit - Bengaluru', status: 'SUBMITTED', total: 18400, who: 'sneha@expense.app' },
    { title: 'Team offsite catering', status: 'APPROVED', total: 42000, who: 'divya@expense.app' },
    { title: 'AWS Summit tickets', status: 'REIMBURSED', total: 26500, who: 'karthik@expense.app' },
    { title: 'Laptop accessories', status: 'DRAFT', total: 7300, who: 'arjun@expense.app' },
    { title: 'Cab reimbursements - July', status: 'REJECTED', total: 5100, who: 'rahul@expense.app' },
    { title: 'Customer dinner - Northwind', status: 'SUBMITTED', total: 12800, who: 'divya@expense.app' },
  ];
  for (const c of claims) {
    const decided = ['APPROVED', 'REJECTED', 'REIMBURSED'].includes(c.status);
    await prisma.expenseClaim.create({
      data: {
        orgId: state.orgId,
        userId: state.userIds.get(c.who)!,
        title: c.title,
        status: c.status,
        totalMinor: minor(c.total),
        submittedAt: c.status !== 'DRAFT' ? new Date(Date.now() - between(2, 18) * 864e5) : null,
        decidedAt: decided ? new Date(Date.now() - between(1, 3) * 864e5) : null,
        decidedById: decided ? ownerId : null,
        reimbursedAt: c.status === 'REIMBURSED' ? new Date(Date.now() - 864e5) : null,
        decisionNote: c.status === 'REJECTED' ? 'Receipts missing for two entries' : null,
        policyFlags: c.status === 'SUBMITTED' ? JSON.stringify(['RECEIPT_MISSING:1']) : null,
      },
    });
  }

  await prisma.integration.createMany({
    data: [
      {
        orgId: state.orgId,
        provider: 'ZOHO_BOOKS',
        displayName: 'Zoho Books (sandbox)',
        status: 'CONNECTED',
        mode: 'SANDBOX',
        config: JSON.stringify({ region: 'in', accountId: 'expenses-default' }),
        scopes: JSON.stringify(['PULL', 'PUSH']),
        lastSyncAt: new Date(Date.now() - 3 * 3600_000),
      },
      {
        orgId: state.orgId,
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
  console.log('Seeding the team and cost categories...');
  await seedTeam();
  console.log('Provisioning the company...');
  await seedOrg();
  const refs = await seedCompanyRecords();
  console.log('Generating 18 months of company spend and revenue...');
  console.log(`  ${await seedLedger(refs)} transactions`);
  console.log('Seeding budgets, subscriptions, payables and claims...');
  await seedPlanning(refs);
  console.log('');
  console.log('Seed complete - Vaseem Technologies.');
  console.log('  demo@expense.app     / Demo#1234   OWNER');
  console.log('  analyst@expense.app  / Demo#1234   FINANCE');
  console.log('  arjun@expense.app    / Demo#1234   MANAGER  (Engineering)');
  console.log('  karthik@expense.app  / Demo#1234   EMPLOYEE (sees only own spend)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export const TX_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;
export type TxType = (typeof TX_TYPES)[number];

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'CREDIT_CARD', 'WALLET', 'INVESTMENT'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ['EXPENSE', 'INCOME'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'NETBANKING', 'AUTO_DEBIT', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BUDGET_PERIODS = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const NOTIFICATION_TYPES = [
  'BUDGET_ALERT',
  'ANOMALY',
  'RECURRING_POSTED',
  'GOAL_REACHED',
  'DIGEST',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** refresh-token family id, only present on refresh tokens */
  fam?: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  currency: string;
}

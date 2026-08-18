/**
 * Lean in-memory row used by every analytics computation.
 * Amounts are MAJOR units here - the conversion happens once, at load.
 */
export interface LedgerRow {
  id: string;
  date: Date;
  amount: number;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  accountId: string;
  accountName: string;
  merchantKey: string | null;
  merchant: string | null;
  description: string;
  paymentMethod: string;
  isRecurring: boolean;
  scope: string;
  taxAmount: number;
  departmentId: string | null;
  departmentName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  projectId: string | null;
  isBillable: boolean;
}

export interface SeriesPoint {
  key: string;
  label: string;
  date: string;
  expense: number;
  income: number;
  net: number;
  count: number;
  movingAvg: number | null;
  cumulative: number;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  total: number;
  count: number;
  share: number;
  average: number;
  largest: number;
  trendPct: number | null;
  volatility: number;
  sparkline: number[];
}

export interface MerchantSlice {
  merchantKey: string;
  name: string;
  total: number;
  count: number;
  average: number;
  share: number;
  firstSeen: string;
  lastSeen: string;
  cadenceDays: number | null;
}

export interface Insight {
  id: string;
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
  title: string;
  detail: string;
  metric?: number;
  unit?: string;
  action?: string;
  tag: string;
}

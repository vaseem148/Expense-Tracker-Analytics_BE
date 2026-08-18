import { CategoryKind } from 'src/common/types/domain.types';

export interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  children?: string[];
}

/**
 * Seeded on registration. Colours are spaced around the hue wheel so that
 * category charts stay distinguishable without a bespoke palette per user.
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Food & Dining', kind: 'EXPENSE', icon: 'utensils', color: '#f97316', children: ['Groceries', 'Restaurants', 'Coffee'] },
  { name: 'Transport', kind: 'EXPENSE', icon: 'car', color: '#0ea5e9', children: ['Fuel', 'Cab & Ride', 'Public Transit'] },
  { name: 'Housing', kind: 'EXPENSE', icon: 'home', color: '#8b5cf6', children: ['Rent', 'Maintenance'] },
  { name: 'Utilities', kind: 'EXPENSE', icon: 'zap', color: '#eab308', children: ['Electricity', 'Internet', 'Mobile'] },
  { name: 'Shopping', kind: 'EXPENSE', icon: 'shopping-bag', color: '#ec4899', children: ['Clothing', 'Electronics'] },
  { name: 'Health', kind: 'EXPENSE', icon: 'heart-pulse', color: '#ef4444', children: ['Pharmacy', 'Doctor', 'Fitness'] },
  { name: 'Entertainment', kind: 'EXPENSE', icon: 'clapperboard', color: '#a855f7', children: ['Streaming', 'Events'] },
  { name: 'Education', kind: 'EXPENSE', icon: 'graduation-cap', color: '#14b8a6' },
  { name: 'Travel', kind: 'EXPENSE', icon: 'plane', color: '#06b6d4' },
  { name: 'Insurance', kind: 'EXPENSE', icon: 'shield', color: '#64748b' },
  { name: 'Subscriptions', kind: 'EXPENSE', icon: 'repeat', color: '#6366f1' },
  { name: 'Gifts & Donations', kind: 'EXPENSE', icon: 'gift', color: '#f43f5e' },
  { name: 'Fees & Charges', kind: 'EXPENSE', icon: 'receipt', color: '#78716c' },
  { name: 'Miscellaneous', kind: 'EXPENSE', icon: 'circle-ellipsis', color: '#94a3b8' },
  { name: 'Salary', kind: 'INCOME', icon: 'briefcase', color: '#22c55e' },
  { name: 'Freelance', kind: 'INCOME', icon: 'laptop', color: '#10b981' },
  { name: 'Investments', kind: 'INCOME', icon: 'trending-up', color: '#84cc16' },
  { name: 'Refunds', kind: 'INCOME', icon: 'undo', color: '#4ade80' },
  { name: 'Other Income', kind: 'INCOME', icon: 'plus-circle', color: '#34d399' },
];

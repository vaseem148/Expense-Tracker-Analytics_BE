import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { Granularity } from '../types/domain.types';

export const WEEK_OPTS = { weekStartsOn: 1 as const }; // ISO weeks start Monday

export function bucketStart(date: Date, g: Granularity): Date {
  switch (g) {
    case 'day':
      return startOfDay(date);
    case 'week':
      return startOfWeek(date, WEEK_OPTS);
    case 'month':
      return startOfMonth(date);
    case 'quarter':
      return startOfQuarter(date);
    case 'year':
      return startOfYear(date);
  }
}

export function bucketEnd(date: Date, g: Granularity): Date {
  switch (g) {
    case 'day':
      return endOfDay(date);
    case 'week':
      return endOfWeek(date, WEEK_OPTS);
    case 'month':
      return endOfMonth(date);
    case 'quarter':
      return endOfQuarter(date);
    case 'year':
      return endOfYear(date);
  }
}

export function addBuckets(date: Date, g: Granularity, n: number): Date {
  switch (g) {
    case 'day':
      return addDays(date, n);
    case 'week':
      return addWeeks(date, n);
    case 'month':
      return addMonths(date, n);
    case 'quarter':
      return addQuarters(date, n);
    case 'year':
      return addYears(date, n);
  }
}

/** Stable, sortable bucket key. Week keys use ISO week-of-year. */
export function bucketKey(date: Date, g: Granularity): string {
  switch (g) {
    case 'day':
      return format(date, 'yyyy-MM-dd');
    case 'week':
      return format(startOfWeek(date, WEEK_OPTS), "yyyy-'W'II");
    case 'month':
      return format(date, 'yyyy-MM');
    case 'quarter':
      return `${format(date, 'yyyy')}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case 'year':
      return format(date, 'yyyy');
  }
}

export function bucketLabel(date: Date, g: Granularity): string {
  switch (g) {
    case 'day':
      return format(date, 'd MMM');
    case 'week':
      return `W${format(startOfWeek(date, WEEK_OPTS), 'II')} ${format(date, 'MMM')}`;
    case 'month':
      return format(date, 'MMM yyyy');
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${format(date, 'yyyy')}`;
    case 'year':
      return format(date, 'yyyy');
  }
}

/** Every bucket start between two dates, inclusive - so gaps become explicit zeros. */
export function enumerateBuckets(from: Date, to: Date, g: Granularity): Date[] {
  const out: Date[] = [];
  let cursor = bucketStart(from, g);
  const limit = bucketStart(to, g);
  let guard = 0;
  while (cursor <= limit && guard++ < 5000) {
    out.push(cursor);
    cursor = addBuckets(cursor, g, 1);
  }
  return out;
}

/** Seasonal period for a granularity: 7 days/week, 12 months/year, 4 quarters/year. */
export function seasonalPeriod(g: Granularity): number {
  switch (g) {
    case 'day':
      return 7;
    case 'week':
      return 4;
    case 'month':
      return 12;
    case 'quarter':
      return 4;
    default:
      return 0;
  }
}

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(differenceInCalendarDays(a, b));
}

/** Parse a YYYY-MM-DD or ISO string; returns null when unparseable. */
export function parseDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Default analytics window: last 12 complete months plus the current one. */
export function defaultRange(now = new Date()): { from: Date; to: Date } {
  return { from: startOfMonth(addMonths(now, -11)), to: endOfDay(now) };
}

export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span - 1), to: new Date(from.getTime() - 1) };
}

export { startOfMonth, endOfMonth, startOfDay, endOfDay, addMonths, addDays, format };

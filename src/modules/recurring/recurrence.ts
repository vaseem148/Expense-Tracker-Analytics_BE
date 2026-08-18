import { addDays, addMonths, addWeeks, addYears } from 'date-fns';
import { Frequency } from 'src/common/types/domain.types';

/**
 * Next occurrence after `from`, respecting interval and the anchor day.
 * Month-end is clamped, so a rule anchored to the 31st fires on the 28th/30th
 * in shorter months instead of skipping them entirely.
 */
export function nextOccurrence(
  from: Date,
  frequency: Frequency,
  interval = 1,
  dayOfMonth?: number | null,
  weekday?: number | null,
): Date {
  const step = Math.max(1, interval);
  let next: Date;

  switch (frequency) {
    case 'DAILY':
      next = addDays(from, step);
      break;
    case 'WEEKLY': {
      next = addWeeks(from, step);
      if (weekday !== undefined && weekday !== null) {
        const diff = (weekday - next.getDay() + 7) % 7;
        next = addDays(next, diff);
      }
      break;
    }
    case 'QUARTERLY':
      next = addMonths(from, 3 * step);
      break;
    case 'YEARLY':
      next = addYears(from, step);
      break;
    default:
      next = addMonths(from, step);
  }

  if ((frequency === 'MONTHLY' || frequency === 'QUARTERLY') && dayOfMonth) {
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(dayOfMonth, lastDay));
  }
  return next;
}

/** How many times a rule fires in a year - used for annualised cost. */
export function occurrencesPerYear(frequency: Frequency, interval = 1): number {
  const base = { DAILY: 365, WEEKLY: 52, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 }[frequency];
  return base / Math.max(1, interval);
}

/**
 * All persisted money is an integer in MINOR units (paise / cents).
 * API boundaries speak MAJOR units (rupees / dollars) as plain numbers.
 * Keeping the conversion in one place is what stops 0.1 + 0.2 bugs from
 * leaking into balances and budget maths.
 */
export const MINOR_PER_MAJOR = 100;

export function toMinor(major: number): number {
  if (!Number.isFinite(major)) return 0;
  const sign = major < 0 ? -1 : 1;
  const abs = Math.abs(major);
  // Shift the decimal point through string exponent notation rather than by
  // multiplying: 1.005 * 100 is 100.49999999999999 in binary floating point,
  // which silently rounds a rupee down. Number('1.005e2') parses as 100.5.
  const shifted = Number(`${abs}e2`);
  const scaled = Number.isFinite(shifted) ? shifted : abs * MINOR_PER_MAJOR;
  // Math.round is half-up, so mirror it for negatives to get half-away-from-zero.
  return sign * Math.round(scaled);
}

export function toMajor(minor: number): number {
  if (!Number.isFinite(minor)) return 0;
  return Math.round(minor) / MINOR_PER_MAJOR;
}

/** Round a major-unit number to 2dp without float tails (e.g. 1.005 -> 1.01). */
export function round2(value: number): number {
  return toMajor(toMinor(value));
}

export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const shifted = Number(`${abs}e${decimals}`);
  const scaled = Number.isFinite(shifted) ? shifted : abs * Math.pow(10, decimals);
  const rounded = Number(`${Math.round(scaled)}e-${decimals}`);
  return sign * (Number.isFinite(rounded) ? rounded : Math.round(scaled) / Math.pow(10, decimals));
}

/** Percentage change from `from` to `to`, guarding division by zero. */
export function pctChange(from: number, to: number): number | null {
  if (from === 0) return to === 0 ? 0 : null;
  return roundTo(((to - from) / Math.abs(from)) * 100, 2);
}

export function share(part: number, whole: number): number {
  if (whole === 0) return 0;
  return roundTo((part / whole) * 100, 2);
}

export function formatMajor(value: number, currency = 'INR', locale = 'en-IN'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

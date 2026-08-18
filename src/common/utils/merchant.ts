import { createHash } from 'node:crypto';

/** Noise that bank statements bolt onto every merchant string. */
const NOISE = [
  /\bUPI\b/gi,
  /\bPOS\b/gi,
  /\bNEFT\b/gi,
  /\bIMPS\b/gi,
  /\bATM\b/gi,
  /\bTXN\b/gi,
  /\bREF\b/gi,
  /\bPVT\b/gi,
  /\bLTD\b/gi,
  /\bINDIA\b/gi,
  /\bPAYMENT\b/gi,
  /\bPURCHASE\b/gi,
  /@[a-z]+/gi, // UPI handles: @okhdfcbank
  /\b\d{4,}\b/g, // long reference numbers
  /\b[a-z0-9]{12,}\b/gi, // opaque transaction ids
];

/**
 * Collapses "UPI/SWIGGY BANGALORE/423891234/@ybl" and "Swiggy Ltd."
 * onto the same key so recurring detection and merchant analytics can
 * group real-world spend that banks describe inconsistently.
 */
export function normaliseMerchant(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.toLowerCase();
  s = s.replace(/[\/|*_\-]+/g, ' ');
  for (const re of NOISE) s = s.replace(re, ' ');
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Statement strings are prefix-informative: the brand comes first.
  const words = s.split(' ').filter((w) => w.length > 1).slice(0, 3);
  const key = words.join(' ').trim();
  return key.length >= 2 ? key : null;
}

/** Human-friendly display name derived from the normalised key. */
export function prettyMerchant(key: string | null): string | null {
  if (!key) return null;
  return key
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Deterministic fingerprint for import de-duplication.
 * Same account + same day + same amount + same merchant = the same row,
 * so re-importing an overlapping statement is a no-op.
 */
export function transactionHash(parts: {
  accountId: string;
  date: Date;
  amountMinor: number;
  description: string;
  type: string;
}): string {
  const day = parts.date.toISOString().slice(0, 10);
  const desc = (normaliseMerchant(parts.description) ?? parts.description.toLowerCase().trim()).slice(0, 40);
  return createHash('sha1')
    .update(`${parts.accountId}|${day}|${parts.amountMinor}|${parts.type}|${desc}`)
    .digest('hex');
}

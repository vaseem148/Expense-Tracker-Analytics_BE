import { createHash } from 'node:crypto';
import { ExternalTransaction } from './connector.interface';

/**
 * Deterministic sample data for SANDBOX mode.
 * Seeded from the connector name so a given integration always replays the
 * same rows - that makes dedupe, mapping and UI states testable without ever
 * touching a real vendor account.
 */
export function sandboxTransactions(seed: string, count = 12): ExternalTransaction[] {
  const rnd = mulberry32(hashSeed(seed));
  const vendors = [
    { name: 'Amazon Web Services', desc: 'Cloud hosting', tax: 18 },
    { name: 'Zoho Corporation', desc: 'CRM subscription', tax: 18 },
    { name: 'Indigo Airlines', desc: 'Business travel', tax: 5 },
    { name: 'WeWork India', desc: 'Coworking seats', tax: 18 },
    { name: 'Freshworks', desc: 'Support desk licence', tax: 18 },
    { name: 'Airtel Business', desc: 'Leased line', tax: 18 },
    { name: 'Chennai Catering Co', desc: 'Team lunch', tax: 5 },
    { name: 'Google Workspace', desc: 'Email and storage', tax: 18 },
  ];

  const out: ExternalTransaction[] = [];
  for (let i = 0; i < count; i++) {
    const v = vendors[Math.floor(rnd() * vendors.length)];
    const base = Math.round((2000 + rnd() * 60000) * 100) / 100;
    const tax = Math.round(base * (v.tax / 100) * 100) / 100;
    const daysAgo = Math.floor(rnd() * 75);
    const date = new Date(Date.now() - daysAgo * 864e5);
    out.push({
      externalId: `${seed}-${i}-${date.toISOString().slice(0, 10)}`,
      date: date.toISOString(),
      amount: Math.round((base + tax) * 100) / 100,
      currency: 'INR',
      description: v.desc,
      merchant: v.name,
      vendorName: v.name,
      type: 'EXPENSE',
      taxAmount: tax,
      taxRatePct: v.tax,
      reference: `REF${Math.floor(rnd() * 1e6)}`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function hashSeed(seed: string): number {
  return parseInt(createHash('md5').update(seed).digest('hex').slice(0, 8), 16);
}

/** Small, fast, seedable PRNG - deterministic across runs and platforms. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

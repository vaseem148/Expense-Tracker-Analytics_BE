import { nextOccurrence, occurrencesPerYear } from '../src/modules/recurring/recurrence';
import { normaliseMerchant, transactionHash } from '../src/common/utils/merchant';

describe('recurrence', () => {
  it('advances monthly rules by one month', () => {
    const next = nextOccurrence(new Date('2026-01-15'), 'MONTHLY', 1, 15);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(15);
  });

  it('clamps a 31st anchor to the last day of a short month', () => {
    const next = nextOccurrence(new Date('2026-01-31'), 'MONTHLY', 1, 31);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('honours multi-period intervals', () => {
    const next = nextOccurrence(new Date('2026-01-10'), 'MONTHLY', 3, 10);
    expect(next.getMonth()).toBe(3);
  });

  it('snaps weekly rules onto the requested weekday', () => {
    const next = nextOccurrence(new Date('2026-01-05'), 'WEEKLY', 1, null, 3);
    expect(next.getDay()).toBe(3);
  });

  it('annualises frequency correctly', () => {
    expect(occurrencesPerYear('MONTHLY')).toBe(12);
    expect(occurrencesPerYear('WEEKLY')).toBe(52);
    expect(occurrencesPerYear('MONTHLY', 3)).toBe(4);
  });
});

describe('merchant normalisation', () => {
  it('collapses bank noise onto a stable key', () => {
    expect(normaliseMerchant('UPI/SWIGGY BANGALORE/423891234/@ybl')).toBe('swiggy bangalore');
    expect(normaliseMerchant('POS 4321 AMAZON PAYMENT')).toBe('amazon');
  });

  it('returns null for unusable input', () => {
    expect(normaliseMerchant('')).toBeNull();
    expect(normaliseMerchant(null)).toBeNull();
    expect(normaliseMerchant('12345678')).toBeNull();
  });

  it('produces a stable dedupe hash for the same logical row', () => {
    const base = {
      accountId: 'acc_1',
      date: new Date('2026-08-18T10:00:00Z'),
      amountMinor: 24950,
      description: 'Swiggy order',
      type: 'EXPENSE',
    };
    const a = transactionHash(base);
    // Same day, different clock time - still the same statement line.
    const b = transactionHash({ ...base, date: new Date('2026-08-18T22:45:00Z') });
    expect(a).toBe(b);
  });

  it('changes the hash when the amount changes', () => {
    const base = {
      accountId: 'acc_1',
      date: new Date('2026-08-18T10:00:00Z'),
      amountMinor: 24950,
      description: 'Swiggy order',
      type: 'EXPENSE',
    };
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, amountMinor: 24951 }));
  });
});

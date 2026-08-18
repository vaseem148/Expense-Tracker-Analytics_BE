import { pctChange, round2, roundTo, share, toMajor, toMinor } from '../src/common/utils/money';

describe('money', () => {
  it('round-trips major and minor units', () => {
    expect(toMinor(249.5)).toBe(24950);
    expect(toMajor(24950)).toBe(249.5);
    expect(toMajor(toMinor(1234.56))).toBe(1234.56);
  });

  it('rounds half away from zero on both signs', () => {
    expect(toMinor(1.005)).toBe(101);
    expect(toMinor(-1.005)).toBe(-101);
  });

  it('kills float tails that break naive addition', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(toMinor(0.1) + toMinor(0.2)).toBe(30);
  });

  it('guards division by zero in pctChange', () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 50)).toBeNull();
    expect(pctChange(200, 250)).toBe(25);
    expect(pctChange(200, 150)).toBe(-25);
  });

  it('computes share safely', () => {
    expect(share(25, 100)).toBe(25);
    expect(share(10, 0)).toBe(0);
  });

  it('rounds to arbitrary precision', () => {
    expect(roundTo(3.14159, 3)).toBe(3.142);
    expect(roundTo(2.5, 0)).toBe(3);
  });
});

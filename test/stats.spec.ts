import {
  autocorrelation,
  coefficientOfVariation,
  detectOutliers,
  ewma,
  gini,
  linearRegression,
  mad,
  mean,
  median,
  movingAverage,
  quantile,
  stdev,
} from '../src/common/utils/stats';

describe('stats kernel', () => {
  it('is total on empty input', () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(stdev([])).toBe(0);
    expect(mad([])).toBe(0);
    expect(gini([])).toBe(0);
    expect(detectOutliers([])).toEqual([]);
  });

  it('computes median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('uses sample stdev (n-1)', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('interpolates quantiles like numpy', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 5);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 5);
  });

  it('detects a large outlier with MAD, not mean', () => {
    // The 5000 would inflate a plain stdev enough to hide itself.
    const found = detectOutliers([100, 102, 98, 101, 99, 103, 97, 5000]);
    expect(found).toHaveLength(1);
    expect(found[0].value).toBe(5000);
    expect(found[0].method).toBe('mad');
  });

  it('ignores noise below the threshold', () => {
    expect(detectOutliers([100, 102, 98, 101, 99, 103, 97, 105])).toHaveLength(0);
  });

  it('fits a perfect line with r2 = 1', () => {
    const fit = linearRegression([2, 4, 6, 8]);
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.predict(4)).toBeCloseTo(10, 6);
  });

  it('null-pads the moving average window', () => {
    const ma = movingAverage([1, 2, 3, 4, 5], 3);
    expect(ma.slice(0, 2)).toEqual([null, null]);
    expect(ma[2]).toBeCloseTo(2, 6);
    expect(ma[4]).toBeCloseTo(4, 6);
  });

  it('weights recent points more heavily in EWMA', () => {
    const smoothed = ewma([10, 10, 10, 100], 0.5);
    expect(smoothed[3]).toBeGreaterThan(smoothed[2]);
    expect(smoothed[3]).toBeLessThan(100);
  });

  it('scores gini 0 for equal spend and near 1 for concentrated spend', () => {
    expect(gini([100, 100, 100, 100])).toBeCloseTo(0, 6);
    expect(gini([1, 1, 1, 1000])).toBeGreaterThan(0.7);
  });

  it('finds periodicity via autocorrelation', () => {
    const seasonal = [10, 2, 2, 10, 2, 2, 10, 2, 2, 10, 2, 2];
    expect(autocorrelation(seasonal, 3)).toBeGreaterThan(0.9);
    expect(autocorrelation(seasonal, 1)).toBeLessThan(0.5);
  });

  it('reports volatility as a unitless ratio', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([50, 150])).toBeCloseTo(0.7071, 3);
  });
});

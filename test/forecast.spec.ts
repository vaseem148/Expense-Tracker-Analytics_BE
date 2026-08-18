import { forecast, holt, holtWinters } from '../src/common/utils/forecast';

describe('forecasting', () => {
  it('returns insufficient-data rather than throwing on a short series', () => {
    const result = forecast([100], 3);
    expect(result.method).toBe('insufficient-data');
    expect(result.points).toEqual([]);
  });

  it('projects a clean linear trend forward', () => {
    const result = forecast([100, 110, 120, 130, 140, 150], 3);
    expect(result.points).toHaveLength(3);
    expect(result.points[0].value).toBeGreaterThan(150);
    expect(result.points[2].value).toBeGreaterThan(result.points[0].value);
  });

  it('widens the interval as the horizon grows', () => {
    const result = forecast([100, 130, 90, 140, 110, 150, 95, 145], 4);
    const first = result.points[0].upper - result.points[0].lower;
    const last = result.points[3].upper - result.points[3].lower;
    expect(last).toBeGreaterThan(first);
  });

  it('never forecasts negative spend', () => {
    const result = forecast([500, 400, 300, 200, 100, 50], 6);
    for (const p of result.points) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.lower).toBeGreaterThanOrEqual(0);
    }
  });

  it('picks Holt-Winters when two full seasons exist', () => {
    const seasonal = Array.from({ length: 24 }, (_, i) => 100 + (i % 12) * 10);
    const result = forecast(seasonal, 3, 12);
    expect(result.method).toBe('holt-winters');
  });

  it('falls back to Holt without enough seasons', () => {
    const result = forecast([10, 20, 30, 40, 50], 2, 12);
    expect(result.method).toBe('holt');
  });

  it('holt returns null below two points', () => {
    expect(holt([5], 3)).toBeNull();
  });

  it('holtWinters refuses a series shorter than two seasons', () => {
    expect(holtWinters([1, 2, 3, 4, 5], 2, 4)).toBeNull();
  });

  it('rates a noisy series lower confidence than a clean one', () => {
    const clean = forecast([100, 101, 102, 103, 104, 105, 106, 107], 2);
    const noisy = forecast([10, 900, 20, 850, 15, 700, 30, 950], 2);
    const rank = { high: 3, medium: 2, low: 1 } as const;
    expect(rank[clean.confidence]).toBeGreaterThanOrEqual(rank[noisy.confidence]);
  });
});

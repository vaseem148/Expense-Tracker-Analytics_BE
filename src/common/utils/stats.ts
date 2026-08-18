/**
 * Dependency-free statistics kernel used by the analytics engine.
 * Every function is pure and total: empty input never throws, it returns a
 * neutral value. That property is what lets the API stay up for a brand new
 * user with zero transactions.
 */

export function sum(xs: number[]): number {
  let acc = 0;
  for (const x of xs) acc += x;
  return acc;
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolated quantile (same method as numpy default). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Sample standard deviation (n-1). Returns 0 for n < 2. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

export function variance(xs: number[]): number {
  return stdev(xs) ** 2;
}

/** Median Absolute Deviation, scaled to be a consistent estimator of sigma. */
export function mad(xs: number[]): number {
  if (!xs.length) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export interface Outlier {
  index: number;
  value: number;
  score: number;
  method: 'zscore' | 'mad' | 'iqr';
}

/**
 * Robust outlier detection. MAD is preferred over plain z-score because a
 * single huge purchase inflates the mean/stdev enough to hide itself.
 * Falls back to z-score when MAD is 0 (more than half the points identical).
 */
export function detectOutliers(xs: number[], threshold = 3): Outlier[] {
  if (xs.length < 4) return [];
  const m = median(xs);
  const scale = mad(xs);
  if (scale > 0) {
    return xs
      .map((value, index) => ({ index, value, score: (value - m) / scale, method: 'mad' as const }))
      .filter((o) => Math.abs(o.score) >= threshold);
  }
  const mu = mean(xs);
  const sd = stdev(xs);
  if (sd === 0) return [];
  return xs
    .map((value, index) => ({ index, value, score: (value - mu) / sd, method: 'zscore' as const }))
    .filter((o) => Math.abs(o.score) >= threshold);
}

export function iqrFences(xs: number[], k = 1.5): { lower: number; upper: number } {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  return { lower: q1 - k * iqr, upper: q3 + k * iqr };
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  predict: (x: number) => number;
}

/** Ordinary least squares fit of y over the index 0..n-1 (or explicit xs). */
export function linearRegression(ys: number[], xs?: number[]): LinearFit {
  const n = ys.length;
  const x = xs ?? ys.map((_, i) => i);
  if (n === 0) return { slope: 0, intercept: 0, r2: 0, predict: () => 0 };
  if (n === 1) return { slope: 0, intercept: ys[0], r2: 1, predict: () => ys[0] };
  const mx = mean(x);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (ys[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  const ssRes = sum(ys.map((y, i) => (y - (slope * x[i] + intercept)) ** 2));
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2, predict: (xi: number) => slope * xi + intercept };
}

/** Trailing simple moving average; the first window-1 points are null-padded. */
export function movingAverage(xs: number[], window: number): (number | null)[] {
  if (window <= 1) return [...xs];
  const out: (number | null)[] = [];
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i];
    if (i >= window) acc -= xs[i - window];
    out.push(i >= window - 1 ? acc / window : null);
  }
  return out;
}

/** Exponentially weighted moving average. alpha in (0,1]; higher = more reactive. */
export function ewma(xs: number[], alpha = 0.3): number[] {
  const out: number[] = [];
  let prev = xs.length ? xs[0] : 0;
  for (let i = 0; i < xs.length; i++) {
    prev = i === 0 ? xs[0] : alpha * xs[i] + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/** Autocorrelation at a given lag - the basis of the recurrence detector. */
export function autocorrelation(xs: number[], lag: number): number {
  if (lag <= 0 || lag >= xs.length) return 0;
  return pearson(xs.slice(0, xs.length - lag), xs.slice(lag));
}

/** Gini coefficient: 0 = spend spread evenly, 1 = all spend in one bucket. */
export function gini(xs: number[]): number {
  const vals = xs.filter((x) => x > 0).sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return 0;
  const total = sum(vals);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * vals[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Coefficient of variation - unitless volatility, comparable across categories. */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stdev(xs) / Math.abs(m);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

import { linearRegression, mean, stdev, sum } from './stats';

export interface ForecastPoint {
  index: number;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  method: 'holt-winters' | 'holt' | 'linear' | 'naive' | 'insufficient-data';
  points: ForecastPoint[];
  /** Mean absolute percentage error of the fitted model on history (0-100). */
  mape: number | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Holt's linear trend method (double exponential smoothing).
 * Chosen over ARIMA on purpose: no matrix maths, stable on the short,
 * gappy series a personal-finance app actually has.
 */
export function holt(series: number[], horizon: number, alpha = 0.4, beta = 0.15) {
  if (series.length < 2) return null;
  let level = series[0];
  let trend = series[1] - series[0];
  const fitted: number[] = [level];
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(level);
  }
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) out.push(level + h * trend);
  return { forecast: out, fitted, level, trend };
}

/**
 * Additive Holt-Winters (triple exponential smoothing) with a fixed period.
 * Needs at least two full seasons of data or it degenerates into noise.
 */
export function holtWinters(
  series: number[],
  horizon: number,
  period: number,
  alpha = 0.35,
  beta = 0.1,
  gamma = 0.3,
) {
  if (period < 2 || series.length < period * 2) return null;

  const seasons = Math.floor(series.length / period);
  const seasonAverages: number[] = [];
  for (let s = 0; s < seasons; s++) {
    seasonAverages.push(mean(series.slice(s * period, (s + 1) * period)));
  }
  const overall = mean(seasonAverages);

  // Initial seasonal indices: average deviation of each slot from its season mean.
  const seasonal: number[] = new Array(period).fill(0);
  for (let i = 0; i < period; i++) {
    let acc = 0;
    for (let s = 0; s < seasons; s++) acc += series[s * period + i] - seasonAverages[s];
    seasonal[i] = acc / seasons;
  }

  let level = overall;
  let trend = (mean(series.slice(period, period * 2)) - mean(series.slice(0, period))) / period;
  const fitted: number[] = [];

  for (let i = 0; i < series.length; i++) {
    const sIdx = i % period;
    const prevLevel = level;
    fitted.push(level + trend + seasonal[sIdx]);
    level = alpha * (series[i] - seasonal[sIdx]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[sIdx] = gamma * (series[i] - level) + (1 - gamma) * seasonal[sIdx];
  }

  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    out.push(level + h * trend + seasonal[(series.length + h - 1) % period]);
  }
  return { forecast: out, fitted, level, trend, seasonal };
}

function mape(actual: number[], fitted: number[]): number | null {
  const pairs = actual
    .map((a, i) => [a, fitted[i]] as const)
    .filter(([a, f]) => a !== 0 && Number.isFinite(f));
  if (!pairs.length) return null;
  return (sum(pairs.map(([a, f]) => Math.abs((a - f) / a))) / pairs.length) * 100;
}

/**
 * Picks the strongest model the data can actually support and returns a
 * forecast with prediction intervals derived from residual spread.
 * `period` is the seasonal cycle length (e.g. 12 for monthly-with-yearly-season,
 * 7 for daily-with-weekly-season); pass 0 to disable seasonality.
 */
export function forecast(series: number[], horizon: number, period = 0): ForecastResult {
  const clean = series.filter((v) => Number.isFinite(v));
  if (clean.length < 2 || horizon <= 0) {
    return { method: 'insufficient-data', points: [], mape: null, confidence: 'low' };
  }

  let values: number[] | null = null;
  let fittedValues: number[] = [];
  let method: ForecastResult['method'] = 'naive';

  const hw = period >= 2 ? holtWinters(clean, horizon, period) : null;
  if (hw) {
    values = hw.forecast;
    fittedValues = hw.fitted;
    method = 'holt-winters';
  } else {
    const h = clean.length >= 4 ? holt(clean, horizon) : null;
    if (h) {
      values = h.forecast;
      fittedValues = h.fitted;
      method = 'holt';
    } else {
      const fit = linearRegression(clean);
      values = Array.from({ length: horizon }, (_, i) => fit.predict(clean.length + i));
      fittedValues = clean.map((_, i) => fit.predict(i));
      method = 'linear';
    }
  }

  const residuals = clean.map((v, i) => v - (fittedValues[i] ?? v));
  const sigma = stdev(residuals) || Math.abs(mean(clean)) * 0.15;
  const err = mape(clean, fittedValues);

  const points: ForecastPoint[] = values.map((v, i) => {
    // Interval widens with the square root of the horizon (random-walk error growth).
    const spread = 1.96 * sigma * Math.sqrt(i + 1);
    const value = Math.max(0, v);
    return {
      index: clean.length + i,
      value,
      lower: Math.max(0, value - spread),
      upper: value + spread,
    };
  });

  const confidence: ForecastResult['confidence'] =
    err === null || clean.length < 4 ? 'low' : err < 15 ? 'high' : err < 35 ? 'medium' : 'low';

  return { method, points, mape: err === null ? null : Math.round(err * 100) / 100, confidence };
}

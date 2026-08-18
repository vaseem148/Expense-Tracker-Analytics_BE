"""Spend forecasting.

Tries Holt-Winters (ExponentialSmoothing) when there are two full seasons of
data, falls back to SARIMAX, then to a damped linear trend. Each step down is
a step the data actually forced, not a preference.
"""
from __future__ import annotations

import warnings

import numpy as np

warnings.filterwarnings("ignore")


def _mape(actual: np.ndarray, fitted: np.ndarray) -> float | None:
    mask = actual != 0
    if not mask.any():
        return None
    return float(np.mean(np.abs((actual[mask] - fitted[mask]) / actual[mask])) * 100)


def forecast(series: list[float], horizon: int = 3, period: int = 12) -> dict:
    y = np.asarray([v for v in series if np.isfinite(v)], dtype=float)
    if len(y) < 3 or horizon <= 0:
        return {"points": [], "model": "insufficient-data", "mape": None, "confidence": "low"}

    values, fitted, model_name = _fit(y, horizon, period)

    residuals = y - fitted[: len(y)]
    sigma = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else float(abs(np.mean(y)) * 0.15)
    err = _mape(y, fitted[: len(y)])

    points = []
    for i, v in enumerate(values):
        # Interval widens with sqrt(h): error compounds like a random walk.
        spread = 1.96 * sigma * np.sqrt(i + 1)
        value = max(0.0, float(v))
        points.append(
            {
                "index": len(y) + i,
                "value": round(value, 2),
                "lower": round(max(0.0, value - spread), 2),
                "upper": round(value + spread, 2),
            }
        )

    confidence = "low"
    if err is not None:
        confidence = "high" if err < 15 else "medium" if err < 35 else "low"

    return {
        "points": points,
        "model": model_name,
        "mape": round(err, 2) if err is not None else None,
        "confidence": confidence,
    }


def _fit(y: np.ndarray, horizon: int, period: int) -> tuple[np.ndarray, np.ndarray, str]:
    if period >= 2 and len(y) >= period * 2:
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing

            model = ExponentialSmoothing(
                y, trend="add", seasonal="add", seasonal_periods=period, damped_trend=True
            ).fit(optimized=True)
            return model.forecast(horizon), model.fittedvalues, "holt-winters-additive"
        except Exception:
            pass

    if len(y) >= 8:
        try:
            from statsmodels.tsa.statespace.sarimax import SARIMAX

            model = SARIMAX(y, order=(1, 1, 1), trend="c").fit(disp=False)
            return (
                np.asarray(model.forecast(horizon)),
                np.asarray(model.fittedvalues),
                "sarimax-111",
            )
        except Exception:
            pass

    # Damped linear trend: extrapolating a raw OLS slope for months is how
    # forecasts end up predicting negative spend.
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    damping = 0.85
    future = np.array(
        [intercept + slope * (len(y) - 1) + slope * sum(damping**k for k in range(1, h + 1))
         for h in range(1, horizon + 1)]
    )
    return future, intercept + slope * x, "damped-linear"

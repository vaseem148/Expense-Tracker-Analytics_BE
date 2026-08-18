"""Unsupervised anomaly detection over transaction features.

Isolation Forest is used because it needs no labels, handles the mixed
numeric/categorical feature space after encoding, and its path-length score is
directly interpretable as "how few splits did it take to isolate this row".
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from ..config import ANOMALY_CONTAMINATION


def build_features(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0.0)
    # Log scale: spend is right-skewed, and without this one large purchase
    # dominates every distance calculation.
    df["log_amount"] = np.log1p(df["amount"].clip(lower=0))

    # Per-category z-score: unusual is relative to the category, not the ledger.
    grouped = df.groupby("category")["amount"]
    df["cat_median"] = grouped.transform("median")
    df["cat_mad"] = grouped.transform(lambda s: (s - s.median()).abs().median())
    df["cat_z"] = np.where(
        df["cat_mad"] > 0,
        (df["amount"] - df["cat_median"]) / (1.4826 * df["cat_mad"]),
        0.0,
    )

    # Cyclical encoding keeps Sunday adjacent to Monday and 23:00 to 00:00.
    df["dow_sin"] = np.sin(2 * np.pi * df["day_of_week"] / 7)
    df["dow_cos"] = np.cos(2 * np.pi * df["day_of_week"] / 7)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

    merchant_counts = df["merchant"].value_counts()
    df["merchant_rarity"] = df["merchant"].map(lambda m: 1.0 / merchant_counts.get(m, 1))
    df["is_recurring_num"] = df["is_recurring"].astype(int)
    return df


FEATURES = [
    "log_amount",
    "cat_z",
    "dow_sin",
    "dow_cos",
    "hour_sin",
    "hour_cos",
    "merchant_rarity",
    "is_recurring_num",
]


def detect(rows: list[dict], contamination: float | None = None) -> list[dict]:
    df = build_features(rows)
    if df.empty or len(df) < 12:
        return []

    rate = contamination or ANOMALY_CONTAMINATION
    X = StandardScaler().fit_transform(df[FEATURES].to_numpy())

    forest = IsolationForest(
        n_estimators=200,
        contamination=rate,
        random_state=42,
        n_jobs=-1,
    )
    labels = forest.fit_predict(X)
    raw = forest.score_samples(X)

    # score_samples is negative-good; flip and normalise to a 0-1 "weirdness".
    weird = (raw.max() - raw) / (raw.max() - raw.min() + 1e-9)

    out: list[dict] = []
    for i, label in enumerate(labels):
        if label != -1:
            continue
        row = df.iloc[i]
        out.append(
            {
                "id": str(row["id"]),
                "score": float(round(weird[i] * 5, 3)),
                "reason": explain(row),
            }
        )
    return sorted(out, key=lambda r: r["score"], reverse=True)


def explain(row: pd.Series) -> str:
    """Human-readable driver, so an alert is actionable rather than mystical."""
    reasons: list[str] = []
    if abs(row["cat_z"]) >= 3:
        reasons.append(f"{row['cat_z']:.1f}x the usual {row['category']} amount")
    if row["merchant_rarity"] >= 1.0:
        reasons.append("first time at this merchant")
    if row["hour"] <= 5:
        reasons.append(f"charged at {int(row['hour'])}:00")
    if row["day_of_week"] in (0, 6) and row["amount"] > row["cat_median"] * 2:
        reasons.append("large weekend spend")
    return "; ".join(reasons) or "unusual combination of amount, timing and merchant"

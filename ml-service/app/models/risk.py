"""Risk models: vendor concentration/compliance and cash-flow shortfall."""
from __future__ import annotations

import numpy as np

# Weights sum to 100. Kept explicit so a finance team can argue with them.
VENDOR_WEIGHTS = {
    "missing_gstin": 25.0,
    "overdue": 30.0,
    "unpaid_exposure": 25.0,
    "thin_history": 10.0,
    "long_terms": 10.0,
}


def score_vendors(vendors: list[dict]) -> list[dict]:
    total_spend = sum(v.get("total_spend", 0.0) for v in vendors) or 1.0
    out = []

    for v in vendors:
        drivers: list[str] = []
        score = 0.0

        if not v.get("has_gstin", True):
            score += VENDOR_WEIGHTS["missing_gstin"]
            drivers.append("No GSTIN on file - input credit at risk")

        overdue = v.get("overdue_invoices", 0)
        if overdue:
            score += min(VENDOR_WEIGHTS["overdue"], overdue * 10.0)
            drivers.append(f"{overdue} overdue invoice(s)")

        spend = v.get("total_spend", 0.0)
        unpaid_ratio = v.get("unpaid_value", 0.0) / max(spend, 1.0)
        if unpaid_ratio > 0:
            score += min(VENDOR_WEIGHTS["unpaid_exposure"], unpaid_ratio * 100)
            drivers.append(f"{unpaid_ratio * 100:.0f}% of spend still unpaid")

        if v.get("transaction_count", 0) < 3:
            score += VENDOR_WEIGHTS["thin_history"]
            drivers.append("Fewer than 3 transactions to judge by")

        if v.get("payment_terms_days", 30) > 60:
            score += VENDOR_WEIGHTS["long_terms"]
            drivers.append("Payment terms beyond 60 days")

        # Concentration is a risk to us, not to them: losing a vendor that
        # carries a third of spend is an operational event.
        concentration = spend / total_spend
        if concentration > 0.3:
            score += 10
            drivers.append(f"Carries {concentration * 100:.0f}% of total vendor spend")

        out.append(
            {
                "id": v["id"],
                "score": float(round(min(100.0, score), 1)),
                "drivers": drivers or ["No material risk signals"],
            }
        )

    return sorted(out, key=lambda r: r["score"], reverse=True)


def cashflow_risk(series: list[float], simulations: int = 5000) -> dict:
    y = np.asarray([v for v in series if np.isfinite(v)], dtype=float)
    if len(y) < 3:
        return {
            "risk_score": 50.0,
            "probability_negative": 50.0,
            "drivers": ["Not enough history to model cash flow"],
            "model": "insufficient-data",
        }

    mu = float(np.mean(y))
    sigma = float(np.std(y, ddof=1)) if len(y) > 1 else abs(mu) * 0.2

    # Bootstrap rather than assume normality: real cash flow has fat tails
    # (one salary month, one tax month) that a Gaussian understates.
    rng = np.random.default_rng(42)
    draws = rng.choice(y, size=(simulations,), replace=True) if sigma > 0 else np.full(simulations, mu)
    noise = rng.normal(0, sigma * 0.5, simulations)
    simulated = draws + noise
    prob_negative = float((simulated < 0).mean() * 100)

    negative_months = int((y < 0).sum())
    volatility = sigma / abs(mu) if mu != 0 else float("inf")

    drivers: list[str] = []
    if negative_months:
        drivers.append(f"{negative_months} of {len(y)} periods were cash-negative")
    if volatility > 1:
        drivers.append("Net cash flow swings more than its own average")
    if mu < 0:
        drivers.append("Average net cash flow is negative")
    if not drivers:
        drivers.append("Cash flow is positive and stable")

    risk = prob_negative
    if mu < 0:
        risk = min(100.0, risk + 15)

    return {
        "risk_score": float(round(risk, 1)),
        "probability_negative": float(round(prob_negative, 1)),
        "drivers": drivers,
        "model": "bootstrap-monte-carlo",
    }

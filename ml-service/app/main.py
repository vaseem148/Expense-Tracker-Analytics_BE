"""Expense Analytics - data-science service.

Deliberately stateless apart from per-user model artifacts on disk: the NestJS
API owns all persistence, this service only turns numbers into predictions.
"""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import MODEL_DIR, SERVICE_VERSION
from .models import anomaly, classifier, clustering, forecasting, risk
from .models.keyword_fallback import guess
from .schemas import (
    AnomalyRequest,
    AnomalyResponse,
    CashflowRequest,
    CategoryPredictRequest,
    CategoryPredictResponse,
    ClusterRequest,
    ClusterResponse,
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
    TrainRequest,
    TrainResponse,
    VendorRequest,
    VendorResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ml")

app = FastAPI(
    title="Expense Analytics ML Service",
    description="Classification, anomaly detection, clustering, forecasting and risk scoring.",
    version=SERVICE_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - started) * 1000
    response.headers["X-Compute-Ms"] = f"{elapsed:.1f}"
    log.info("%s %s -> %s in %.1fms", request.method, request.url.path, response.status_code, elapsed)
    return response


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    artifacts = sorted(p.name for p in MODEL_DIR.glob("*.joblib"))
    return HealthResponse(
        status="ok",
        version=SERVICE_VERSION,
        models={
            "category_classifier": "tfidf-char-wb + ComplementNB",
            "anomaly": "IsolationForest(200)",
            "clustering": "KMeans + silhouette-selected k",
            "forecast": "HoltWinters -> SARIMAX -> damped-linear",
            "risk": "weighted-rules + bootstrap-monte-carlo",
            "trained_artifacts": len(artifacts),
        },
    )


@app.post("/predict/category", response_model=CategoryPredictResponse)
def predict_category(req: CategoryPredictRequest) -> CategoryPredictResponse:
    if req.user_id:
        pipeline = classifier.load(req.user_id)
        if pipeline is not None:
            ranked = classifier.predict(pipeline, req.description)
            if ranked:
                top, confidence = ranked[0]
                return CategoryPredictResponse(
                    category=top,
                    confidence=confidence,
                    alternatives=[
                        {"category": c, "confidence": p} for c, p in ranked[1:]
                    ],
                    model="per-user-complement-nb",
                )

    hit = guess(req.description)
    if hit:
        label, confidence = hit
        return CategoryPredictResponse(
            category=label, confidence=confidence, alternatives=[], model="keyword-rules"
        )

    return CategoryPredictResponse(
        category="Miscellaneous", confidence=0.2, alternatives=[], model="default"
    )


@app.post("/train/category", response_model=TrainResponse)
def train_category(req: TrainRequest) -> TrainResponse:
    texts = [s.text for s in req.samples]
    labels = [s.label for s in req.samples]
    result = classifier.train(req.user_id, texts, labels)
    return TrainResponse(**result, model="tfidf+complement-nb")


@app.post("/detect/anomalies", response_model=AnomalyResponse)
def detect_anomalies(req: AnomalyRequest) -> AnomalyResponse:
    rows = [
        {
            "id": t.id,
            "amount": t.amount,
            "category": t.category,
            "merchant": t.merchant,
            "day_of_week": t.day_of_week,
            "hour": t.hour,
            "is_recurring": t.is_recurring,
        }
        for t in req.transactions
    ]
    found = anomaly.detect(rows, req.contamination)
    return AnomalyResponse(
        anomalies=found,
        model="isolation-forest",
        contamination=req.contamination or 0.04,
    )


@app.post("/cluster/merchants", response_model=ClusterResponse)
def cluster_merchants(req: ClusterRequest) -> ClusterResponse:
    payload = [
        {
            "key": m.key,
            "name": m.name,
            "total": m.total,
            "frequency": m.frequency,
            "average_ticket": m.average_ticket,
        }
        for m in req.merchants
    ]
    return ClusterResponse(**clustering.cluster(payload, req.k))


@app.post("/forecast/spend", response_model=ForecastResponse)
def forecast_spend(req: ForecastRequest) -> ForecastResponse:
    return ForecastResponse(**forecasting.forecast(req.series, req.horizon, req.period))


@app.post("/score/vendors", response_model=VendorResponse)
def score_vendors(req: VendorRequest) -> VendorResponse:
    payload = [v.model_dump() for v in req.vendors]
    return VendorResponse(scores=risk.score_vendors(payload), model="weighted-vendor-risk")


@app.post("/score/cashflow")
def score_cashflow(req: CashflowRequest) -> dict:
    result = risk.cashflow_risk(req.series, req.simulations)
    return {
        "riskScore": result["risk_score"],
        "probabilityNegative": result["probability_negative"],
        "drivers": result["drivers"],
        "model": result["model"],
    }

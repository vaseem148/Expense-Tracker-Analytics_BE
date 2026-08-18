"""Request/response contracts shared with the NestJS backend."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CategoryPredictRequest(BaseModel):
    description: str
    amount: float | None = None
    labels: list[str] = Field(default_factory=list)
    user_id: str | None = Field(default=None, alias="userId")

    model_config = {"populate_by_name": True}


class CategoryAlternative(BaseModel):
    category: str
    confidence: float


class CategoryPredictResponse(BaseModel):
    category: str
    confidence: float
    alternatives: list[CategoryAlternative]
    model: str


class TrainingSample(BaseModel):
    text: str
    amount: float = 0.0
    label: str


class TrainRequest(BaseModel):
    user_id: str = Field(alias="userId")
    samples: list[TrainingSample]

    model_config = {"populate_by_name": True}


class TrainResponse(BaseModel):
    accuracy: float
    samples: int
    classes: int
    model: str


class AnomalyTransaction(BaseModel):
    id: str
    amount: float
    category: str = "Uncategorised"
    merchant: str = ""
    day_of_week: int = Field(default=0, alias="dayOfWeek")
    hour: int = 0
    is_recurring: bool = Field(default=False, alias="isRecurring")

    model_config = {"populate_by_name": True}


class AnomalyRequest(BaseModel):
    transactions: list[AnomalyTransaction]
    contamination: float | None = None


class AnomalyItem(BaseModel):
    id: str
    score: float
    reason: str


class AnomalyResponse(BaseModel):
    anomalies: list[AnomalyItem]
    model: str
    contamination: float


class MerchantFeature(BaseModel):
    key: str
    name: str
    total: float
    frequency: int
    average_ticket: float = Field(alias="averageTicket")

    model_config = {"populate_by_name": True}


class ClusterRequest(BaseModel):
    merchants: list[MerchantFeature]
    k: int | None = None


class ClusterInfo(BaseModel):
    id: int
    label: str
    size: int
    centroid: dict[str, float]


class ClusterResponse(BaseModel):
    clusters: list[ClusterInfo]
    assignments: dict[str, int]
    silhouette: float
    model: str


class ForecastRequest(BaseModel):
    series: list[float]
    horizon: int = 3
    period: int = 12


class ForecastPoint(BaseModel):
    index: int
    value: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    points: list[ForecastPoint]
    model: str
    mape: float | None
    confidence: str


class VendorFeature(BaseModel):
    id: str
    name: str
    transaction_count: int = Field(default=0, alias="transactionCount")
    total_spend: float = Field(default=0.0, alias="totalSpend")
    invoice_count: int = Field(default=0, alias="invoiceCount")
    overdue_invoices: int = Field(default=0, alias="overdueInvoices")
    unpaid_value: float = Field(default=0.0, alias="unpaidValue")
    has_gstin: bool = Field(default=True, alias="hasGstin")
    payment_terms_days: int = Field(default=30, alias="paymentTermsDays")

    model_config = {"populate_by_name": True}


class VendorRequest(BaseModel):
    vendors: list[VendorFeature]


class VendorScore(BaseModel):
    id: str
    score: float
    drivers: list[str]


class VendorResponse(BaseModel):
    scores: list[VendorScore]
    model: str


class CashflowRequest(BaseModel):
    series: list[float]
    simulations: int = 5000


class CashflowResponse(BaseModel):
    risk_score: float = Field(serialization_alias="riskScore")
    probability_negative: float = Field(serialization_alias="probabilityNegative")
    drivers: list[str]
    model: str

    model_config = {"populate_by_name": True}


class HealthResponse(BaseModel):
    status: str
    version: str
    models: dict[str, Any]

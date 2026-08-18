"""Per-user expense category classifier.

TF-IDF character+word n-grams into a Complement Naive Bayes head.
ComplementNB is chosen over MultinomialNB because personal spending is
heavily imbalanced - a user has hundreds of "Groceries" rows and three
"Insurance" rows, and CNB is specifically the correction for that skew.
"""
from __future__ import annotations

import re

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import Pipeline
from sklearn.model_selection import cross_val_score

from ..config import MIN_TRAINING_SAMPLES, MODEL_DIR

_NOISE = re.compile(r"\b(upi|pos|neft|imps|txn|ref|payment|purchase)\b", re.I)
_DIGITS = re.compile(r"\b\d{3,}\b")


def normalise(text: str) -> str:
    text = text.lower()
    text = _NOISE.sub(" ", text)
    text = _DIGITS.sub(" ", text)
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(3, 5),
                    min_df=1,
                    sublinear_tf=True,
                    max_features=20000,
                ),
            ),
            ("clf", ComplementNB(alpha=0.3)),
        ]
    )


def model_path(user_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)[:64]
    return str(MODEL_DIR / f"category-{safe}.joblib")


def train(user_id: str, texts: list[str], labels: list[str]) -> dict:
    if len(texts) < MIN_TRAINING_SAMPLES:
        raise ValueError(f"need at least {MIN_TRAINING_SAMPLES} samples, got {len(texts)}")

    cleaned = [normalise(t) for t in texts]
    pipeline = build_pipeline()

    # Cross-validation only makes sense when every class has enough members.
    unique, counts = np.unique(labels, return_counts=True)
    folds = int(min(5, counts.min())) if len(unique) > 1 else 0
    accuracy = 0.0
    if folds >= 2:
        accuracy = float(cross_val_score(pipeline, cleaned, labels, cv=folds).mean())

    pipeline.fit(cleaned, labels)
    joblib.dump(pipeline, model_path(user_id))
    return {"accuracy": round(accuracy, 4), "samples": len(texts), "classes": int(len(unique))}


def load(user_id: str) -> Pipeline | None:
    try:
        return joblib.load(model_path(user_id))
    except Exception:
        return None


def predict(pipeline: Pipeline, text: str, top_k: int = 3) -> list[tuple[str, float]]:
    probs = pipeline.predict_proba([normalise(text)])[0]
    classes = pipeline.named_steps["clf"].classes_
    order = np.argsort(probs)[::-1][:top_k]
    return [(str(classes[i]), float(probs[i])) for i in order]

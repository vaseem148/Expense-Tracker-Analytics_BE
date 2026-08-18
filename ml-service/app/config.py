"""Runtime configuration for the ML service."""
from __future__ import annotations

import os
from pathlib import Path

MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).resolve().parent.parent / "artifacts"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

SERVICE_VERSION = "1.0.0"

# Isolation Forest contamination: the share of rows we expect to be anomalous.
# 4% keeps the alert list short enough that a human will actually read it.
ANOMALY_CONTAMINATION = float(os.getenv("ANOMALY_CONTAMINATION", "0.04"))

# Minimum labelled rows before a per-user classifier is worth training.
MIN_TRAINING_SAMPLES = int(os.getenv("MIN_TRAINING_SAMPLES", "20"))

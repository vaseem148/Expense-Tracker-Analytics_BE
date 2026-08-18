# Expense Analytics - ML service

FastAPI + scikit-learn service that backs the data-science features of the API.
The NestJS backend calls it over HTTP and degrades to deterministic rule-based
fallbacks whenever this service is unreachable, so it is optional at runtime.

## Endpoints

| Method | Path                  | Purpose                                            |
| ------ | --------------------- | -------------------------------------------------- |
| GET    | `/health`             | Liveness and loaded-model inventory                 |
| POST   | `/predict/category`   | TF-IDF + Complement Naive Bayes category suggestion |
| POST   | `/train/category`     | Train a per-user classifier, persisted with joblib  |
| POST   | `/detect/anomalies`   | Isolation Forest over amount/time/category features |
| POST   | `/cluster/merchants`  | KMeans segmentation with silhouette-picked k        |
| POST   | `/forecast/spend`     | Holt-Winters / SARIMAX forecast with intervals      |
| POST   | `/score/vendors`      | Weighted vendor-risk model                          |
| POST   | `/score/cashflow`     | Monte-Carlo probability of a negative period        |

## Run

```bash
cd ml-service
uv venv && uv pip install -r requirements.txt
uv run uvicorn app.main:app --reload --port 8000
```

Point the API at it with `ML_SERVICE_URL=http://localhost:8000`.

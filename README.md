# Expense Analytics — Backend

Expense intelligence platform for **individuals and companies**: a ledger, an
analytics engine, an org-scoped business layer, an integration framework and a
Python data-science service — behind one typed REST API.

```
NestJS 11 · Prisma 6 · SQLite (Postgres-ready) · Passport JWT · Socket.IO
FastAPI · scikit-learn · statsmodels · pandas
```

---

## Quick start

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:push
pnpm seed          # 18 months of realistic data + a full business workspace
pnpm dev           # http://localhost:4000/api/v1
```

Docs: **http://localhost:4000/api/docs** (Swagger, persisted bearer auth)

| Account               | Password    | Role                     |
| --------------------- | ----------- | ------------------------ |
| `demo@expense.app`    | `Demo#1234` | ADMIN + org OWNER        |
| `analyst@expense.app` | `Demo#1234` | org FINANCE              |

Optional ML service:

```bash
cd ml-service
uv venv && uv pip install -r requirements.txt
uv run uvicorn app.main:app --port 8000
```

The API degrades gracefully to deterministic in-process fallbacks when the ML
service is not running — nothing 500s, predictions just get less clever.

---

## What is in here

### Analytics engine (`src/modules/analytics`)

Pure, dependency-free maths over an in-memory ledger — one query feeds a dozen
computations, and every function is total (empty input returns a neutral value,
never an exception).

- **Time series** — day/week/month/quarter/year buckets, gaps filled with
  explicit zeros, trailing moving average, cumulative position
- **Forecasting** — Holt-Winters → Holt → OLS, auto-selected by what the data
  can actually support; prediction intervals widen with √horizon
- **Anomaly detection** — median absolute deviation scored *per category*,
  because a single large purchase inflates mean/stdev enough to hide itself
- **Recurrence mining** — finds undeclared subscriptions from gap and amount
  dispersion, with a confidence score and annualised cost
- **Pareto & concentration** — vital-few categories, Gini coefficient
- **Budget performance** — consumed vs *pace*, so "80% spent on day 5" reads as
  at-risk rather than fine
- **Financial health score** — five weighted, individually explainable pillars
- **Insights** — deterministic narrative rules; every sentence traces to a number

### Business layer (`src/modules/business`)

Organizations, members with role hierarchy (`OWNER > ADMIN > FINANCE > MANAGER >
EMPLOYEE`), departments with budgets, vendors, projects, and:

- **Expense claims** — `DRAFT → SUBMITTED → APPROVED/REJECTED → REIMBURSED`
  with an explicit transition table, policy evaluation on submit, and a hard
  block on approving your own claim
- **Accounts payable** — invoices with derived aging buckets and DPO exposure
- **Board metrics** — burn, net burn, runway, margin, cost per employee
- **P&L** with prior-period comparison, **GST** by rate slab with input credit,
  **vendor concentration** risk, **cash-flow projection** including committed
  invoice outflow

### Integrations (`src/modules/integrations`)

A connector interface (`test` / `pull` / `push` / `notify`) with implementations
for **Tally, Zoho Books, QuickBooks, Xero, bank feeds, Razorpay, Google Sheets,
Slack and generic webhooks**. Every connector runs in `SANDBOX` mode with
deterministic seeded data, so the whole flow is demonstrable without credentials.

- Credentials encrypted at rest with **AES-256-GCM** (tampering fails loudly)
- Sync de-duplicates against the same transaction hash CSV import uses
- **Outbound webhooks** — HMAC-SHA256 signed, exponential backoff, auto-disable
- **API keys** — SHA-256 hashed, scoped, shown exactly once

### Data science (`ml-service/`)

| Model | Why this one |
| --- | --- |
| TF-IDF char n-grams → **ComplementNB** | Personal spend is heavily class-imbalanced; CNB is the correction for exactly that |
| **Isolation Forest** | No labels needed, and path length is directly explainable |
| **KMeans** + silhouette-selected k | Merchant segments without hard-coding granularity |
| **Holt-Winters → SARIMAX → damped linear** | Each fallback is one the data forced |
| **Bootstrap Monte Carlo** | Cash flow has fat tails a Gaussian understates |

### Platform

- **Auth** — argon2id, rotating refresh tokens; reusing a revoked token burns
  the entire token family
- **Money** — integers in minor units everywhere; `1.005 * 100` is
  `100.49999999999999` in binary float, so conversion goes through string
  exponent notation instead
- **Realtime** — Socket.IO rooms keyed by user id (the room *is* the authz boundary)
- **Scheduler** — recurring posting, budget sweeps, anomaly scans, housekeeping
- **Cross-cutting** — one error envelope, response wrapper, request tracing,
  audit interceptor, per-route throttling, tag-invalidated TTL cache

---

## API surface

| Group | Base |
| --- | --- |
| Auth & sessions | `/api/v1/auth` |
| Ledger | `/api/v1/transactions` |
| Accounts / categories / tags | `/api/v1/accounts`, `/categories` |
| Budgets / goals / recurring | `/api/v1/budgets`, `/goals`, `/recurring` |
| Analytics | `/api/v1/analytics/*` |
| Business | `/api/v1/orgs/:orgId/*` |
| Integrations | `/api/v1/integrations/*` |
| Data science | `/api/v1/ml/*` |
| Import / export | `/api/v1/data/*` |
| Health | `/api/v1/health`, `/health/ready` |

## Tests

```bash
pnpm test
```

36 tests over the maths that everything else depends on — the money conversion
bug above was caught by one of them.

## Notes on choices

- **SQLite** so the project runs with zero infrastructure. The schema avoids
  enums and arrays, so moving to Postgres is a `datasource` change.
- **Soft deletes** on transactions: analytics stay reproducible and an accidental
  delete is recoverable.
- **Derived balances** — never stored. An edited transaction cannot leave a
  stale balance behind.

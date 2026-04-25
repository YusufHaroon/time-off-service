# Time-Off Microservice

## Overview

A NestJS microservice that manages employee time-off requests in coordination with an external HCM (Human Capital Management) system. Employees submit requests; the service validates against their leave balance (held in a local SQLite cache), deducts pending days optimistically, and synchronises the deduction with the HCM API. Managers approve or reject requests through the same service. A scheduled background job retries transient HCM failures and keeps the local balance cache in sync.

## Tech Stack

- **NestJS 11** (plain JavaScript + Babel — no TypeScript)
- **SQLite** via TypeORM + better-sqlite3 (in-memory for tests)
- **@nestjs/config** — environment-variable management via ConfigService
- **@nestjs/schedule** — cron-based HCM retry/sync jobs
- **@nestjs/axios** — HTTP client for HCM API calls
- **class-validator / class-transformer** — DTO validation
- **Jest 30** — unit, integration, and concurrency tests
- **Nock** — HTTP mocking for HCM client tests
- **Express mock HCM server** — in-process fake HCM for integration tests

## Prerequisites

- Node.js >= 18
- npm >= 9

## Setup & Run

```bash
npm install
cp .env.example .env        # edit HCM_BASE_URL and HCM_API_KEY
npm run start:dev
```

Service runs on <http://localhost:3000>

For a plain (non-watch) start:

```bash
npm start
```

## Running Tests

```bash
npm test                                              # all tests
npm test -- --coverage                                # with coverage report
npm test -- --coverage --forceExit                    # coverage + force-close DB handles
npm test -- --testPathPattern integration             # integration only (AppModule boot)
npm test -- --testPathPattern concurrency             # concurrency / race-condition only
npm test -- --testPathPattern mock-hcm               # mock HCM server tests
```

Coverage thresholds (enforced by Jest):

| Metric     | Threshold |
|------------|-----------|
| Statements | 90%       |
| Branches   | 80%       |
| Functions  | 90%       |
| Lines      | 90%       |

## API Endpoints

All time-off-request routes require a role header: `X-User-Role: employee` or `X-User-Role: manager`. The acting user is identified by `X-User-Id`.

| Method   | Path                     | Role              | Description                                                        |
|----------|--------------------------|-------------------|--------------------------------------------------------------------|
| `GET`    | `/health`                | open              | Liveness/readiness check — returns `{ status, timestamp, database }` |
| `GET`    | `/`                      | open              | Default greeting (scaffold)                                        |
| `POST`   | `/time-off-requests`     | employee          | Submit a new time-off request; validates balance and posts to HCM  |
| `GET`    | `/time-off-requests`     | employee, manager | List requests with optional filters (see query params below)       |
| `GET`    | `/time-off-requests/:id` | employee, manager | Fetch a single request by UUID                                     |
| `PATCH`  | `/time-off-requests/:id` | manager, employee | Transition status: `APPROVED`, `REJECTED`, or `CANCELLED`         |
| `DELETE` | `/time-off-requests/:id` | employee          | Hard-delete a `DRAFT` request (other statuses are rejected)        |

### POST /time-off-requests — request body

```json
{
  "employeeId": "emp-001",
  "locationId": "loc-hq",
  "leaveType": "ANNUAL",
  "startDate": "2026-08-01",
  "endDate": "2026-08-05",
  "daysRequested": 4,
  "notes": "Family trip"
}
```

`leaveType` must be one of: `ANNUAL`, `SICK`, `MATERNITY`, `PATERNITY`, `UNPAID`.

### PATCH /time-off-requests/:id — request body

```json
{
  "status": "REJECTED",
  "managerId": "mgr-007",
  "rejectionReason": "Insufficient notice"
}
```

`rejectionReason` is required when `status` is `REJECTED`.

### GET /time-off-requests — query parameters

| Param          | Type   | Description                       |
|----------------|--------|-----------------------------------|
| `employeeId`   | string | Filter by employee                |
| `locationId`   | string | Filter by location                |
| `leaveType`    | enum   | Filter by leave type              |
| `status`       | enum   | Filter by request status          |
| `startDateFrom`| date   | Start-date range lower bound      |
| `startDateTo`  | date   | Start-date range upper bound      |
| `page`         | int    | Page number (default: 1)          |
| `limit`        | int    | Page size 1–100 (default: 20)     |

## Architecture Decisions

See the TRD for full detail. Key decisions are summarised below.

### Optimistic locking for balance mutations

`BalanceService` maintains a `version` column on every `Balance` row. All mutations (`deduct`, `confirmDeduction`, `restore`, `releasePending`) issue an `UPDATE … WHERE id = ? AND version = ?`. If zero rows are affected a concurrent writer won the race; the operation retries up to `BALANCE_LOCK_RETRIES` times with a random back-off before throwing `409 Conflict`. This prevents double-deductions without holding a transaction lock across the full request lifecycle.

### PENDING_HCM retry flow

When the HCM API is transiently unavailable during request creation, the request is saved with status `PENDING_HCM` and the balance deduction remains in the `pendingDays` bucket. A scheduled job calls `RequestService.retryPendingHcm()` on each tick (cron schedule: `SYNC_CRON`). On each attempt the job tries to post the deduction to HCM. If successful the request is promoted to `APPROVED` and `pendingDays` are confirmed. On permanent failure (after `HCM_RETRY_ATTEMPTS` attempts) the request is marked `FAILED` and pending days are released back to available.

### Batch sync idempotency

`BalanceService.upsert()` performs a read-then-write keyed on the `(employeeId, locationId, leaveType)` unique constraint. Re-submitting the same snapshot is a no-op for `totalDays`/`usedDays`. If `totalDays` changes by more than 0.1, `pendingDays` is reset to zero and an audit entry is written. All upserts are recorded in the append-only `audit_log` table with `action = SYNCED`.

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values.

| Variable                          | Description                                                  | Default                |
|-----------------------------------|--------------------------------------------------------------|------------------------|
| `DATABASE_PATH`                   | Path to the SQLite file; use `:memory:` for tests            | `data/timeoff.sqlite`  |
| `HCM_BASE_URL`                    | Base URL of the HCM REST API (required)                      | —                      |
| `HCM_API_KEY`                     | API key sent in the `X-HCM-API-Key` header (required)        | —                      |
| `HCM_TIMEOUT_MS`                  | Per-request timeout for HCM HTTP calls, in milliseconds      | `3000`                 |
| `HCM_RETRY_ATTEMPTS`              | Maximum PENDING_HCM retry attempts before marking `FAILED`   | `5`                    |
| `BALANCE_LOCK_RETRIES`            | Max optimistic-lock retries per balance mutation             | `3`                    |
| `SYNC_CRON`                       | Cron expression for the HCM retry / balance-sync job         | `0 1 * * *`            |
| `BALANCE_REFRESH_THRESHOLD_MINUTES` | Minimum age (minutes) of a cached balance before refresh   | `15`                   |
| `PORT`                            | HTTP port the service listens on                             | `3000`                 |

## Known Limitations & Assumptions

- **Single-tenant only.** There is no tenant isolation; all employees share a single SQLite database.
- **Calendar days, not business days.** `daysRequested` is a caller-supplied number; the service does not compute working days from date ranges.
- **Mock JWT authentication.** Role and identity are read from `X-User-Role` and `X-User-Id` headers. In production this guard must be replaced with real JWT verification middleware.
- **SQLite is suitable for development and demo only.** For production workloads use PostgreSQL (change the TypeORM `type` and install `pg`). The optimistic-lock strategy is portable to any RDBMS TypeORM supports.
- **No soft-delete.** `DELETE /time-off-requests/:id` performs a hard remove and is restricted to `DRAFT` requests.
- **HCM batch sync endpoint is not yet exposed.** The `BatchSyncDto` and `BalanceService.upsert()` are in place; wiring a `POST /sync` controller endpoint is left for the next iteration.

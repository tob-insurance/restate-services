# Oracle Integration — `apps/finance`

Analysis of all Oracle (Genius ERP) usage within the finance service.

---

## Table of Contents

1. [Environment & Configuration](#1-environment--configuration)
2. [Connection Management](#2-connection-management)
3. [Oracle Operations](#3-oracle-operations)
   - [Trial Balance Extraction](#31-trial-balance-extraction)
   - [Genius Closing Job Submission](#32-genius-closing-job-submission)
   - [Genius Closing Job Status](#33-genius-closing-job-status)
4. [Data Types](#4-data-types)
5. [Error Handling](#5-error-handling)
6. [Data Flow](#6-data-flow)
7. [Security Notes](#7-security-notes)
8. [Configuration Constants](#8-configuration-constants)
9. [File Reference](#9-file-reference)

---

## 1. Environment & Configuration

| Variable | Required | Description |
|---|---|---|
| `ORACLE_URL` | Yes | Full Oracle connection string (e.g. `oracle://user:pass@host:1521/SID`) |
| `ORACLE_INSTANT_CLIENT_PATH` | No | Path to Oracle Instant Client libs (macOS/Windows local dev) |
| `ORACLE_LIB_DIR` | No | Fallback alias for `ORACLE_INSTANT_CLIENT_PATH` |

Source: `src/env.d.ts:19-26`

---

## 2. Connection Management

File: `src/infrastructure/database.ts`

**Pattern: lazy singleton with warm-up hook.**

```
getOracleClient()          — lazy init, throws if ORACLE_URL missing
initOracleClient()         — called at module load (Lambda cold-start warm-up)
testConnections()          — parallel health check of Oracle + Postgres
closeConnections()         — graceful teardown, nullifies references
```

The `oracleClient` reference is module-scoped (`let oracleClient: OracleClient | null`). First call to `getOracleClient()` creates the pool via `@restate-tob/oracle`'s `createOracleClientFromUrl()`; subsequent calls return the cached instance.

**Lambda entry point** (`src/app.lambda.ts:8`): calls `initOracleClient()` at import time to pre-warm the connection pool before the first invocation.

**Local dev** (`src/app.local.ts:9`): calls `testConnections()` at startup; Oracle failure is non-fatal (logged, does not crash the process).

### Connection helper: `withConnection()`

Imported from `@restate-tob/oracle`. Used in all direct Oracle statement execution:

```typescript
await withConnection(getOracleClient(), async (connection) => {
  await connection.execute(...);
  // pool releases connection on return or error
});
```

---

## 3. Oracle Operations

### 3.1 Trial Balance Extraction

File: `src/modules/trial-balance-sync/sync.service.ts:31-73`

**Function**: `syncTrialBalanceFromGenius(year, month)`

Uses the `OpenBalanceRepository` from `@restate-tob/oracle` which internally manages an Oracle cursor. Consumed via async iterator:

```typescript
const repository = new OpenBalanceRepository(getOracleClient());
for await (const openBalance of repository.getList(year, month)) { ... }
```

The repository executes a SELECT against the Genius schema and streams results row-by-row — no full result set loaded into memory.

**Fields read from each Oracle row:**

| Oracle field | Mapped to | Notes |
|---|---|---|
| `coaCode` | `coaCode` | Chart of Account code |
| `branch` | `branchCode` | Branch identifier |
| `description` | `description` | Account name |
| `beginningDebit` | `startDebit` | Cast to `Number` |
| `beginningCredit` | `startCredit` | Cast to `Number` |
| `debitAmount` | `movementDebit` | Cast to `Number` |
| `creditAmount` | `movementCredit` | Cast to `Number` |
| `endingDebit` | `endDebit` | Cast to `Number` |
| `endingCredit` | `endCredit` | Cast to `Number` |

Computed fields (`startBalance`, `movementBalance`, `endBalance`) are `debit - credit` calculated in TypeScript, not in SQL.

After streaming, records are collected into a `Map<string, CalculatedTrialBalance>` keyed as `${coaCode}|${branch}`, then passed to `processCoaHierarchy()` (see [Data Flow](#6-data-flow)).

---

### 3.2 Genius Closing Job Submission

File: `src/modules/closing/services/genius-closing.service.ts:25-115`

**Function**: `submitGeniusClosingJob(closingDate, userId, currentTimeMillis?)`

Submits an asynchronous Oracle Scheduler job that triggers the Genius month-end close process.

**Oracle package called:**
```sql
Package_Rpt_Ac_Fi806.get_master_data(year, month, month, userId, l_out_1, l_out_2)
```

This is wrapped in an anonymous PL/SQL block and submitted to `DBMS_SCHEDULER`:

```sql
BEGIN
  DBMS_SCHEDULER.CREATE_JOB (
    job_name   => :jobName,
    job_type   => 'PLSQL_BLOCK',
    job_action => :jobAction,   -- the PL/SQL block above
    enabled    => TRUE
  );
END;
```

- Bind parameters `:jobName` and `:jobAction` are named Oracle bind variables (safe, no interpolation risk on the scheduler call itself).
- `autoCommit: true` is required for `DBMS_SCHEDULER.CREATE_JOB`.

**Job naming convention:**
```
GNS_{YY}{MM}_{BASE36_TIMESTAMP}
Example: GNS_2503_LK9XY2
```

---

### 3.3 Genius Closing Job Status

File: `src/modules/closing/services/genius-closing.service.ts:117-186`

**Function**: `checkGeniusClosingJobStatus(jobName)`

Queries the Oracle data dictionary view:

```sql
SELECT state, failure_count,
       TO_CHAR(last_start_date, 'YYYY-MM-DD HH24:MI:SS') AS last_start,
       TO_CHAR(last_run_duration, 'HH24:MI:SS') AS duration
FROM user_scheduler_jobs
WHERE job_name = :jobName
```

- Uses `OUT_FORMAT_OBJECT` from `oracledb` — rows returned as objects with **uppercase** column names (`STATE`, `FAILURE_COUNT`, `LAST_START`, `DURATION`).
- Bind parameter `:jobName` prevents injection.
- Job disappearing from `user_scheduler_jobs` is treated as **successful completion** (scheduler auto-cleans completed jobs).

**State mapping:**

| Oracle `STATE` | `running` | `completed` | `failed` |
|---|---|---|---|
| `RUNNING` | true | false | false |
| `SUCCEEDED` | false | true | false |
| `COMPLETED` | false | true | false |
| `FAILED` | false | false | true |
| `failure_count > 0` | — | — | true |
| row not found | false | true | false |

---

## 4. Data Types

### `CalculatedTrialBalance` (from `@restate-tob/oracle`)

Used to carry Oracle trial balance data through the system:

```typescript
type CalculatedTrialBalance = {
  coaCode: string;
  branchCode: string;
  description: string;
  startDebit: number;
  startCredit: number;
  startBalance: number;     // startDebit - startCredit
  movementDebit: number;
  movementCredit: number;
  movementBalance: number;  // movementDebit - movementCredit
  endDebit: number;
  endCredit: number;
  endBalance: number;       // endDebit - endCredit
  hasAnyValue: boolean;     // false if all fields are 0 (zero records excluded from insert)
};
```

### `GeniusClosingJobSubmit` (`src/modules/closing/types.ts:3-8`)

```typescript
type GeniusClosingJobSubmit = {
  submitted: boolean;
  jobName: string;      // e.g. "GNS_2503_LK9XY2"
  message: string;
  startTime: DateTime;
};
```

### `GeniusJobStatus` (`src/modules/closing/types.ts:10-16`)

```typescript
type GeniusJobStatus = {
  status: string;       // Oracle STATE value or "NOT_FOUND"
  running: boolean;
  completed: boolean;
  failed: boolean;
  message: string;
};
```

---

## 5. Error Handling

| Location | Condition | Behavior |
|---|---|---|
| `database.ts:31` | `ORACLE_URL` not set | Throws `Error` immediately |
| `database.ts:41` | Pool init failed | Throws `Error` |
| `genius-closing.service.ts:55-58` | Invalid year/month format | `TerminalError` HTTP 400 |
| `genius-closing.service.ts:61-66` | Invalid `userId` format | `TerminalError` HTTP 400 |
| `genius-closing.service.ts:107-111` | Zod validation failure on submit | `TerminalError` HTTP 400 |
| `genius-closing.service.ts:179-183` | Zod validation failure on job name | `TerminalError` HTTP 400 |
| `daily-closing.workflow.ts:144-149` | Job not found after submission | `TerminalError` HTTP 500 |
| `daily-closing.workflow.ts:189-192` | Job `failed` during poll | `TerminalError` HTTP 500 |
| `daily-closing.workflow.ts:210-213` | Poll timeout (max attempts exceeded) | `TerminalError` HTTP 504 |
| `sync.service.ts:157-161` | PostgreSQL insert fails during sync | ROLLBACK + re-throw |
| `sync.service.ts:181-195` | Any error during sync | Returns `SyncTrialBalanceResult { success: false }` |

`TerminalError` (from `@restatedev/restate-sdk`) signals to Restate that the error is non-retryable.

---

## 6. Data Flow

```
                     ┌─────────────────────────────────────────────┐
                     │           Oracle (Genius ERP)                │
                     │                                              │
                     │  Package_Rpt_Ac_Fi806.get_master_data()      │
                     │  DBMS_SCHEDULER.CREATE_JOB()                 │
                     │  user_scheduler_jobs  (dictionary view)      │
                     │  OpenBalanceRepository  (cursor/stream)      │
                     └────────────────┬────────────────────────────┘
                                      │
               ┌──────────────────────▼──────────────────────────┐
               │         daily-closing.workflow.ts                │
               │                                                  │
               │  Step 1 — Oracle Closing                         │
               │    submitGeniusClosingJob()                      │
               │    poll checkGeniusClosingJobStatus() × 7        │
               │    (initial wait 5h, then every 1h)              │
               │                                                  │
               │  Step 2 — Sync Trial Balance                     │
               │    syncTrialBalanceFromGenius()                  │
               │    → stream Oracle rows                          │
               │    → processCoaHierarchy()                       │
               │      (aggregates leaf→parent, bottom-up)         │
               │    → UPSERT legacy_trial_balances (batches 1000) │
               │                                                  │
               │  Step 3 — Financial Metrics                      │
               │    calculateFinancialMetrics()  [PostgreSQL fn]  │
               └──────────────────────────────────────────────────┘
```

**COA hierarchy processing** (`sync.service.ts:199-335`):

1. Load `legacy_chart_of_accounts` from PostgreSQL (code, parent_code, level, name).
2. Build `childrenLookup` map and group nodes by level.
3. Iterate levels **descending** (leaf → root):
   - Leaf nodes: use Genius value if present, else zero.
   - Parent nodes: sum all children's debit/credit fields.
4. Only records where `hasAnyValue = true` are inserted into PostgreSQL.

---

## 7. Security Notes

**Input validation before Oracle interaction:**

All inputs are validated with strict regex before being used in Oracle calls:

| Input | Validator | Regex |
|---|---|---|
| `closingDate` | `DateStringSchema` | `/^\d{4}-\d{2}-\d{2}$/` |
| `userId` | `UserIdSchema` | `/^[a-zA-Z0-9_]+$/` |
| `jobName` | `JobNameSchema` | `/^[A-Z0-9_]+$/` |
| `yearStr` | inline | `/^\d{4}$/` |
| `monthStr` | inline | `/^\d{2}$/` |

**String interpolation vs bind parameters:**

- `Package_Rpt_Ac_Fi806.get_master_data(...)` arguments (`yearStr`, `monthStr`, `userId`) are **interpolated** into the PL/SQL block string, not bound. The strict regex validation above (numeric-only year/month, alphanumeric-only userId) mitigates injection risk, but this is worth noting.
- `DBMS_SCHEDULER.CREATE_JOB` and `user_scheduler_jobs` queries use **named bind parameters** (`:jobName`, `:jobAction`) — correct and safe.

---

## 8. Configuration Constants

File: `src/constants.ts`

| Constant | Value | Purpose |
|---|---|---|
| `TIMEZONE` | `"Asia/Jakarta"` | Scheduler cron timezone |
| `DEFAULT_USER_ID` | `"adm"` | Default Genius user for job submission |
| `DAILY_CLOSING_SCHEDULE_TIME` | `"23:00"` | Daily trigger time |
| `GENIUS_JOB_CONFIG.initialDelayHours` | `5` | Wait before first status poll |
| `GENIUS_JOB_CONFIG.pollIntervalHours` | `1` | Interval between status polls |
| `GENIUS_JOB_CONFIG.maxPollAttempts` | `7` | Max polls before timeout (~12h total) |

---

## 9. File Reference

| File | Role |
|---|---|
| `src/infrastructure/database.ts` | Oracle client singleton, init, health check, teardown |
| `src/infrastructure/validation.ts` | Zod schemas used to validate inputs before Oracle calls |
| `src/env.d.ts` | Environment variable type declarations |
| `src/constants.ts` | Genius job timing and schedule configuration |
| `src/app.lambda.ts` | Calls `initOracleClient()` at module load |
| `src/app.local.ts` | Calls `testConnections()` at dev startup |
| `src/modules/closing/services/genius-closing.service.ts` | Job submission + status monitoring |
| `src/modules/closing/types.ts` | `GeniusClosingJobSubmit`, `GeniusJobStatus` types |
| `src/modules/closing/workflows/daily-closing.workflow.ts` | Restate workflow orchestrating all three steps |
| `src/modules/closing/handlers/scheduler.handler.ts` | Daily cron trigger for the workflow |
| `src/modules/trial-balance-sync/sync.service.ts` | Oracle data extraction, COA hierarchy, PG upsert |
| `src/modules/trial-balance-sync/sync-and-calculate.service.ts` | Wrapper combining sync + metrics steps |

**External packages touching Oracle:**

- `@restate-tob/oracle` — connection pool abstraction, `withConnection()`, `OpenBalanceRepository`
- `oracledb` v6.10.0 — native driver (only `OUT_FORMAT_OBJECT` constant imported directly in app code)

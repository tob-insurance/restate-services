# SOA Finance: PostgreSQL Migration Design

**Date:** 2026-05-18
**Status:** Design (pre-implementation)
**App:** `@restate-tob/soa-finance`

## Overview

Replace the Oracle database dependency in `apps/soa-finance/` with PostgreSQL. The Oracle tables (`MASTER_CM`, `MASTER_BRANCH`, `MASTER_COLLECTION`, and the ~15 tables used by the SOA pipeline query) have already been migrated to a running PostgreSQL instance. This design covers the code changes needed to point at PostgreSQL instead.

## Scope

**In scope:**
- `@restate-tob/postgres` shared package — extend with missing features
- `apps/soa-finance/src/infrastructure/database/` — rewrite to use PostgreSQL
- `apps/soa-finance/src/pipeline/read/` — replace Oracle streaming with PostgreSQL
- `apps/soa-finance/src/pipeline/read/index.ts` (SOA_QUERY) — rewrite Oracle SQL to PostgreSQL dialect
- `apps/soa-finance/src/app.local.ts` / `app.lambda.ts` — entry point updates
- `apps/soa-finance/package.json` — dependency swaps
- `apps/soa-finance/.env.schema`, `.env.example`, `src/env.d.ts` — env var changes

**Out of scope:**
- Business logic in `modules/soa/`, `modules/reminder/`, `modules/document-generation/`, `modules/email/`, `modules/payment/` (none use Oracle)
- Pipeline `transform/` and `write/` (result processing, not database-dependent)
- Pipeline `dev-data.ts` (synthetic data generator)
- `apps/finance/` (separate app, keeps Oracle for now)
- `packages/oracle/` (kept for `apps/finance`)

## Architecture

### Before (Oracle)

```
app.local.ts                   pipeline/scheduler.ts
    │                               │
    ▼                               ▼
infrastructure/database/      pipeline/read/
  database.ts (OracleClient)    oracle-stream-reader.ts
  queries/                      read/index.ts (SOA_QUERY)
    customer-query.ts               │
    branch-query.ts                 ▼
        │                     pipeline/transform/
        ▼                       soa-transformer.ts
    modules/                        │
      soa/                          ▼
      reminder/               pipeline/write/
                                  Parquet → S3
```

### After (PostgreSQL)

```
app.local.ts                   pipeline/scheduler.ts
    │                               │
    ▼                               ▼
infrastructure/database/      pipeline/read/
  postgres.ts (PostgresClient)  pg-stream-reader.ts
  queries/                      read/index.ts (SOA_QUERY rewritten)
    customer-query.ts               │
    branch-query.ts                 ▼
        │                     pipeline/transform/
        ▼                       soa-transformer.ts
    modules/                        │
      soa/                          ▼
      reminder/               pipeline/write/
                                  Parquet → S3
```

Module consumers (`batch-workflow.ts`, `soa-customer.ts`, `process-branches.ts`, `generate-reminder-letter.ts`) — **zero changes**. They import `getAllAccounts`, `getAccountById`, `getAllBranches`, `getAccountEmails` from the database layer and the signatures don't change.

## 1. Extend `@restate-tob/postgres` Package

### New exports

```typescript
// client.executeQuery — convenience wrapper on poolClient.query()
executeQuery<T>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>

// Async generator for streaming large result sets (replaces Oracle cursor streaming)
withConnectionGenerator<T>(
  client: PostgresClient,
  operation: (poolClient: PoolClient) => AsyncGenerator<T>
): AsyncGenerator<T>
```

### Streaming implementation

Uses `pg-cursor` for cursor-based streaming (same pattern as `oracledb` ResultSet):

```typescript
import Cursor from "pg-cursor";

async function* withConnectionGenerator<T>(client, operation) {
  const poolClient = await client.pool.connect();
  try {
    yield* operation(poolClient);
  } finally {
    poolClient.release();
  }
}
```

### Lambda pool sizing

Auto-detect Lambda via `AWS_LAMBDA_FUNCTION_NAME` env var (same pattern as `@restate-tob/oracle`):
- Lambda: `poolMin: 0, poolMax: 1`
- Non-Lambda: `poolMin: 2, poolMax: 20` (existing defaults)

### Files to modify

| File | Change |
|------|--------|
| `packages/postgres/src/types.ts` | Add `executeQuery` to `PostgresClient` interface |
| `packages/postgres/src/client.ts` | Implement `executeQuery`, `withConnectionGenerator`, Lambda pool sizing |
| `packages/postgres/src/index.ts` | Export new items |
| `packages/postgres/package.json` | Add `pg-cursor` dependency |

## 2. Database Layer (`infrastructure/database/`)

### database.ts → postgres.ts

Replace `@restate-tob/oracle` imports with `@restate-tob/postgres`:

| Before (Oracle) | After (PostgreSQL) |
|---|---|
| `createOracleClientFromUrl` | `createPostgresClient` |
| `ORACLE_URL` env var | `DATABASE_URL` env var |
| `ORACLE_LIB_DIR` / instant client path | Remove |
| `getOracleClient()` singleton | `getPostgresClient()` singleton |
| `testOracleConnection()` via `SELECT SYSDATE FROM DUAL` | `testPostgresConnection()` via `SELECT 1` |
| `executeSoaProcedure()` with cursor OUT binds | Remove (not needed; pipeline uses direct SQL) |

**Singleton exports kept identical:**
- `executeQuery<T>(sql, binds?)` → same signature, PG implementation
- `closeConnections()` → same behavior (calls `client.close()`)
- `testConnection()` → returns `Promise<boolean>`

### Query files

Bind syntax change only (Oracle named params → PG positional params):

| File | Oracle | PostgreSQL |
|---|---|---|
| `customer-query.ts` | `:customerId`, `:officeCode`, `:cmCode` | `$1`, `$2`, `$3` |
| `branch-query.ts` | (no binds) | unchanged |
| All | `executeQuery(query, { key: val })` | `executeQuery(query, [val1, val2])` |

### Files to modify

| File | Action |
|------|--------|
| `database.ts` → `postgres.ts` | Rewrite |
| `types.ts` | Keep `IBranch` — unchanged |
| `index.ts` | Update re-exports (remove `database`, add `postgres`) |
| `queries/customer-query.ts` | Rewrite SQL syntax + bind style |
| `queries/branch-query.ts` | Minor: verify SQL works as-is |

## 3. Pipeline Streaming

### oracle-stream-reader.ts → pg-stream-reader.ts

Replace `oracledb` result set streaming with `pg-cursor`:

```typescript
// Before (Oracle)
async function* streamQueryFromOracle(sql, binds) {
  yield* withConnectionGenerator(client, async function* (connection) {
    const result = await connection.execute(sql, binds, { resultSet: true });
    const resultSet = result.resultSet;
    let rows = await resultSet.getRows(500);
    while (rows.length > 0) {
      for (const row of rows) yield row;
      rows = await resultSet.getRows(500);
    }
  });
}

// After (PostgreSQL)
async function* streamQueryFromPg(sql, params) {
  yield* withConnectionGenerator(pgClient, async function* (poolClient) {
    const cursor = poolClient.query(new Cursor(sql, params));
    let rows = await cursor.read(500);
    while (rows.length > 0) {
      for (const row of rows) yield row;
      rows = await cursor.read(500);
    }
    await cursor.close();
  });
}
```

### SOA_QUERY rewrite (Oracle → PostgreSQL dialect)

The ~124 line query in `pipeline/read/index.ts` needs these transformations:

| Oracle | PostgreSQL |
|--------|-----------|
| `NVL(expr, default)` | `COALESCE(expr, default)` |
| `TRUNC(date)` | `date::date` or `DATE_TRUNC('day', date)` |
| `SYSDATE` | `CURRENT_DATE` |
| `TO_CHAR(date, 'yyyyMM')` | `TO_CHAR(date, 'YYYYMM')` |
| `:p_as_at_date` | `$1` |
| `FROM DUAL` | Remove (implicit in PG) |

Table names, JOINs, column aliases remain the same (same schema, already migrated).

### Constants

Remove `ORACLE_STREAM.FETCH_ARRAY_SIZE` from `constants/constants.ts`. The 500-row batch size moves inline or becomes `PG_STREAM` constant.

### Files to modify

| File | Action |
|------|--------|
| `oracle-stream-reader.ts` → `pg-stream-reader.ts` | Rewrite |
| `pipeline/read/index.ts` | Update imports + rewrite SOA_QUERY for PG dialect |
| `pipeline/types.ts` | Remove `IOracleStreamOptions` |
| `pipeline/index.ts` | Update import (minimal) |
| `constants/constants.ts` | Remove `ORACLE_STREAM` |

## 4. Environment & Config

### .env.schema

```diff
- # Oracle Database (URL format)
- ORACLE_URL=oracle://user:password@host:1521/ORCL
+ # PostgreSQL Database (URL format)
+ DATABASE_URL=postgresql://user:password@host:5432/dbname

- # Oracle Instant Client library path
- ORACLE_LIB_DIR=
```

### .env.example

Same changes as `.env.schema`.

### env.d.ts

Replace `ORACLE_URL` / `ORACLE_LIB_DIR` type declarations with `DATABASE_URL`. Regenerate via `varlock` or update manually.

### package.json

```diff
- "dependencies": {
-   "oracledb": "^6.10.0",
-   "@restate-tob/oracle": "workspace:*"
- }
+ "dependencies": {
+   "pg": "^8.16.0",
+   "pg-cursor": "^2.12.0",
+   "@restate-tob/postgres": "workspace:*"
+ }

- "devDependencies": {
-   "@types/oracledb": "^6.10.1"
- }
+ "devDependencies": {
+   "@types/pg": "^8.11.0"
+ }

// Lambda bundle scripts
- "bundle:lambda": "--external:oracledb"
+  (remove --external:oracledb, add @restate-tob/postgres to bundled deps)
- "postbundle:lambda": "cp -rL ../node_modules/oracledb node_modules/"
+ "postbundle:lambda": (remove oracledb cp, add pg + pg-cursor if needed)
```

## 5. Entry Points

### app.local.ts

```diff
- import { initOracleClient, testOracleConnection } from "./infrastructure/database/database.js";
+ import { initPostgresClient, testPostgresConnection } from "./infrastructure/database/postgres.js";

- initOracleClient();
- const oracle = await testOracleConnection();
+ initPostgresClient();
+ const pg = await testPostgresConnection();
```

### app.lambda.ts

Same changes as `app.local.ts`.

## 6. SQL Query Map

### Complete SQL migration table

| File | Current Oracle SQL | Notes for PG rewrite |
|------|--------------------|---------------------|
| `customer-query.ts:5-11` | `SELECT ... FROM MASTER_CM WHERE IS_CUSTOMER = 'N'` | Only bind syntax change (`$1`); `"code"` aliases work as-is |
| `customer-query.ts:24-34` | `SELECT ... FROM MASTER_CM WHERE CM_CODE = :customerId` | `CM_CODE = $1` |
| `customer-query.ts:49-53` | `SELECT DISTINCT EMAIL FROM MASTER_COLLECTION WHERE CM_CODE = :cmCode` | `$1`, `$2` positional |
| `branch-query.ts:5` | `SELECT OFFICE_CODE AS "officeCode" ... FROM MASTER_BRANCH` | No binds — works as-is |
| `pipeline/read/index.ts:3-126` | Massive query with `NVL`, `TRUNC`, `SYSDATE`, `TO_CHAR(...)`, `:p_as_at_date` | Full rewrite per Section 3 table above |

## 7. File Inventory

### Files to create (3)

| File | Purpose |
|------|---------|
| `apps/soa-finance/src/infrastructure/database/postgres.ts` | New database singleton (replaces `database.ts`) |
| `apps/soa-finance/src/pipeline/read/pg-stream-reader.ts` | PG streaming reader (replaces `oracle-stream-reader.ts`) |
| — | (no other new files; all changes are modifications or deletions) |

### Files to delete (2)

| File | Reason |
|------|--------|
| `apps/soa-finance/src/infrastructure/database/database.ts` | Replaced by `postgres.ts` |
| `apps/soa-finance/src/pipeline/read/oracle-stream-reader.ts` | Replaced by `pg-stream-reader.ts` |

### Files to modify (12)

| File | Change description |
|------|--------------------|
| `packages/postgres/src/client.ts` | Add `executeQuery`, `withConnectionGenerator`, Lambda pool sizing |
| `packages/postgres/src/types.ts` | Extend `PostgresClient` interface with `executeQuery` |
| `packages/postgres/src/index.ts` | Export new items |
| `packages/postgres/package.json` | Add `pg-cursor` dependency |
| `apps/soa-finance/src/infrastructure/database/index.ts` | Update to export from `postgres.ts` |
| `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts` | Positional bind params |
| `apps/soa-finance/src/pipeline/read/index.ts` | Import `streamQueryFromPg`, rewrite SOA_QUERY SQL dialect |
| `apps/soa-finance/src/pipeline/types.ts` | Remove `IOracleStreamOptions` |
| `apps/soa-finance/src/app.local.ts` | Postgres init/connect |
| `apps/soa-finance/src/app.lambda.ts` | Postgres init |
| `apps/soa-finance/package.json` | Dependency swaps |
| `apps/soa-finance/src/constants/constants.ts` | Remove `ORACLE_STREAM` |

### Files to modify — env/config (3)

| File | Change |
|------|--------|
| `apps/soa-finance/.env.schema` | `DATABASE_URL` replaces `ORACLE_URL`, remove `ORACLE_LIB_DIR` |
| `apps/soa-finance/.env.example` | Same |
| `apps/soa-finance/src/env.d.ts` | Regenerate or manual update |

**Total: 20 files** (3 create + 2 delete + 15 modify)

## 8. Module Consumer Verification

The following modules use the database layer but need **zero code changes** — they import from `../../infrastructure/database/index.js` and use the same function signatures:

| Module | Function used | Signature stays |
|--------|--------------|----------------|
| `modules/soa/workflows/batch-workflow.ts` | `getAllAccounts()` | `() => Promise<IAccount[]>` |
| `modules/soa/services/process-branches.ts` | `getAllBranches()` | `() => Promise<IBranch[]>` |
| `modules/soa/objects/soa-customer.ts` | `getAccountById(id)` | `(id: string) => Promise<IAccount\|null>` |
| `modules/reminder/generate-reminder-letter.ts` | `getAccountEmails(code, office?)` | `(code, office?) => Promise<string[]>` |

## 9. Testing Strategy

1. **TypeScript compilation** — `bun run build` on `@restate-tob/postgres` and `apps/soa-finance`
2. **LSP diagnostics** — clean on all changed files
3. **Runtime (local)** — `bun run dev` with local PG connection
4. **Pipeline verification** — `pipeline/dev-data.ts` path works unchanged; real path needs PG with seeded data
5. **SQL correctness** — each rewritten query should be manually compared for semantic equivalence

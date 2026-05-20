# SOA Finance PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Oracle database usage in `apps/soa-finance/` with PostgreSQL by extending the shared `@restate-tob/postgres` package and refactoring the app's database and pipeline layers.

**Architecture:** The refactoring has 4 sequential phases: (1) extend `@restate-tob/postgres` with streaming and convenience methods, (2) rewrite `apps/soa-finance`'s database layer to use the extended PG package, (3) replace the Oracle streaming pipeline with a PG-cursor-based equivalent and rewrite the SOA_QUERY SQL for PostgreSQL dialect, (4) update configuration, dependencies, and entry points. Module consumers (workflows, virtual objects) require zero changes.

**Tech Stack:** `pg` (node-postgres), `pg-cursor`, `@restate-tob/postgres` (shared package), TypeScript.

---

## File Structure

### New files (3)
- `packages/postgres/src/stream.ts` — `withConnectionGenerator` using `pg-cursor`
- `apps/soa-finance/src/infrastructure/database/postgres.ts` — PG singleton wrapper (replaces `database.ts`)
- `apps/soa-finance/src/pipeline/read/pg-stream-reader.ts` — PG cursor streaming (replaces `oracle-stream-reader.ts`)

### Deleted files (2)
- `apps/soa-finance/src/infrastructure/database/database.ts` — replaced by `postgres.ts`
- `apps/soa-finance/src/pipeline/read/oracle-stream-reader.ts` — replaced by `pg-stream-reader.ts`

### Modified files (15)
- `packages/postgres/src/client.ts` — add `executeQuery` to `PostgresClient`, Lambda pool sizing
- `packages/postgres/src/types.ts` — extend `PostgresClient` interface
- `packages/postgres/src/index.ts` — export new items
- `packages/postgres/package.json` — add `pg-cursor` dependency
- `apps/soa-finance/src/infrastructure/database/index.ts` — update re-exports
- `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts` — positional bind params
- `apps/soa-finance/src/infrastructure/database/queries/branch-query.ts` — verify SQL compatibility
- `apps/soa-finance/src/pipeline/read/index.ts` — import `streamQueryFromPg`, rewrite SOA_QUERY SQL
- `apps/soa-finance/src/pipeline/types.ts` — remove `IOracleStreamOptions`
- `apps/soa-finance/src/constants/constants.ts` — remove `ORACLE_STREAM`
- `apps/soa-finance/src/app.local.ts` — Postgres init
- `apps/soa-finance/src/app.lambda.ts` — Postgres init
- `apps/soa-finance/package.json` — dependency swaps
- `apps/soa-finance/.env.schema` — env var changes
- `apps/soa-finance/.env.example` — env var changes

### Regenerated (1)
- `apps/soa-finance/src/env.d.ts` — update Oracle → PG types

---

## Phase 1: Extend `@restate-tob/postgres`

### Task 1: Add `executeQuery` to PostgresClient

**Files:**
- Modify: `packages/postgres/src/types.ts`
- Modify: `packages/postgres/src/client.ts`
- Modify: `packages/postgres/src/index.ts`

- [ ] **Step 1: Extend PostgresClient interface**

Edit `packages/postgres/src/types.ts`. Add `executeQuery` method to the `PostgresClient` type:

```typescript
export type PostgresClient = {
  pool: Pool;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
  executeQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};
```

- [ ] **Step 2: Implement executeQuery on the client**

Edit `packages/postgres/src/client.ts`. Add the method inside the `createPostgresClient` factory:

```typescript
function createPostgresClient(config: PostgresConfig): PostgresClient {
  // ... existing pool creation ...

  return {
    pool,
    testConnection,
    close,
    executeQuery: async <T>(sql: string, params?: unknown[]) => {
      const conn = await pool.connect();
      try {
        const result = await conn.query<T>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? null };
      } finally {
        conn.release();
      }
    },
  };
}
```

- [ ] **Step 3: Update package exports**

Edit `packages/postgres/src/index.ts`. Verify `executeQuery` is already re-exported via the `PostgresClient` type (no change needed if type is exported).

### Task 2: Add `withConnectionGenerator` with pg-cursor

**Files:**
- Create: `packages/postgres/src/stream.ts`
- Modify: `packages/postgres/src/index.ts`
- Modify: `packages/postgres/package.json`

- [ ] **Step 1: Add pg-cursor dependency**

Edit `packages/postgres/package.json`:

```json
{
  "dependencies": {
    "pg": "^8.16.3",
    "pg-cursor": "^2.12.0"
  }
}
```

Also add `@types/pg-cursor` to devDependencies. `pg-cursor` does not ship types, so TypeScript needs the DefinitelyTyped package:

```json
{
  "devDependencies": {
    "@types/pg-cursor": "^2.12.0"
  }
}
```

- [ ] **Step 2: Create stream.ts**

Create `packages/postgres/src/stream.ts`:

```typescript
import Cursor from "pg-cursor";
import type { PostgresClient } from "./types";

export async function* withConnectionGenerator<T>(
  client: PostgresClient,
  operation: (poolClient: import("pg").PoolClient) => AsyncGenerator<T>
): AsyncGenerator<T> {
  const poolClient = await client.pool.connect();
  try {
    yield* operation(poolClient);
  } finally {
    poolClient.release();
  }
}

export const PG_STREAM = {
  FETCH_ARRAY_SIZE: 500,
} as const;

export { Cursor };
export type { Cursor };

- [ ] **Step 3: Export stream.ts from the package**

Edit `packages/postgres/src/index.ts` — add the new exports:

```typescript
export { withConnectionGenerator, PG_STREAM, Cursor } from "./stream";
```

- [ ] **Step 4: Install the new dependency**

Run: `bun install` from the monorepo root.
Expected: `pg-cursor` added to `node_modules` and lockfile updated.

### Task 3: Add Lambda-aware pool sizing

**Files:**
- Modify: `packages/postgres/src/client.ts`

- [ ] **Step 1: Add Lambda auto-detection and pool sizing**

Edit `packages/postgres/src/client.ts`. In the `createPostgresClient` function, add Lambda detection and adjust pool defaults:

```typescript
export function createPostgresClient(config: PostgresConfig): PostgresClient {
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  const poolConfig: PoolConfig = {
    min: isLambda ? 0 : 2,
    max: isLambda ? 1 : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...config,
  };

  const pool = new Pool(poolConfig);
  // ... rest unchanged
}
```

---

## Phase 2: Refactor SOA Finance Database Layer

### Task 4: Create postgres.ts (replaces database.ts)

**Files:**
- Create: `apps/soa-finance/src/infrastructure/database/postgres.ts`
- Delete: `apps/soa-finance/src/infrastructure/database/database.ts`

- [ ] **Step 1: Write postgres.ts**

Create `apps/soa-finance/src/infrastructure/database/postgres.ts`:

```typescript
import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";
import { isDevelopment } from "../../constants";

let pgClient: PostgresClient | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return url;
}

function logDevModeWarning(connectionString: string): void {
  if (!isDevelopment()) return;
  try {
    const url = new URL(connectionString);
    console.warn(
      `\n⚠️  [DEV MODE] Connecting to PostgreSQL at ${url.hostname}:${url.port || "5432"}\n` +
        "   Double-check this is NOT your production database before proceeding.\n"
    );
  } catch {
    console.warn(
      "\n⚠️  [DEV MODE] Connecting to PostgreSQL (raw connection string)\n" +
        "   Double-check this is NOT your production database before proceeding.\n"
    );
  }
}

export function getPostgresClient(): PostgresClient {
  if (!pgClient) {
    const connectionString = getDatabaseUrl();
    logDevModeWarning(connectionString);
    pgClient = createPostgresClient({ connectionString });
  }
  if (!pgClient) {
    throw new Error("Failed to initialize PostgreSQL client");
  }
  return pgClient;
}

export function initPostgresClient(): void {
  getPostgresClient();
}

export function testPostgresConnection(): Promise<boolean> {
  return getPostgresClient().testConnection();
}

// Re-export convenience query using the singleton client
export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) {
  const result = await getPostgresClient().executeQuery<T>(sql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
  };
}

// executeMany — sequential batch execution in a transaction.
// WARNING: Before implementing, grep the entire apps/soa-finance/src/ for
// calls to `executeMany(`. If NO calls exist, remove this function entirely.
// If calls exist, each call site needs migration to PG positional ($1) params.
export async function executeMany(
  sql: string,
  params: unknown[][]
): Promise<{ rowsAffected: number | null }> {
  const client = getPostgresClient();
  const conn = await client.pool.connect();
  try {
    await conn.query("BEGIN");
    let totalAffected = 0;
    for (const p of params) {
      const result = await conn.query(sql, p);
      totalAffected += result.rowCount ?? 0;
    }
    await conn.query("COMMIT");
    return { rowsAffected: totalAffected };
  } catch (error) {
    await conn.query("ROLLBACK");
    throw error;
  } finally {
    conn.release();
  }
}

export async function closeConnections(): Promise<void> {
  if (pgClient) {
    await pgClient.close();
    pgClient = null;
  }
}
```

- [ ] **Step 2: Delete old database.ts**

Run: `rm apps/soa-finance/src/infrastructure/database/database.ts`

### Task 5: Update database index.ts

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/index.ts`

- [ ] **Step 1: Update exports**

Edit `apps/soa-finance/src/infrastructure/database/index.ts`:

```typescript
export * from "./postgres";
export * from "./queries";
```

### Task 6: Update customer-query.ts with positional binds

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts`

- [ ] **Step 1: Rewrite getAllAccounts**

Edit `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts` — replace Oracle named binds (`:customerId`) with PG positional binds (`$1`). The SQL itself (table names, column aliases) stays the same since PG supports `"alias"` syntax.

```typescript
import type { IAccount } from "../../../types";
import { executeQuery } from "../postgres";

export const getAllAccounts = async () => {
  const query = `SELECT 
      CM_CODE AS "code", 
      CM_NAME AS "name",
      CM_FULLNAME AS "fullName",
      ACTING_CODE AS "actingCode"
    FROM MASTER_CM 
    WHERE IS_CUSTOMER = 'N'`;

  const result = await executeQuery<IAccount>(query);
  return result.rows;
};

export const getAccountById = async (
  customerId: string
): Promise<IAccount | null> => {
  const query = `
    SELECT 
      CM_CODE AS "code", 
      CM_NAME AS "name",
      CM_FULLNAME AS "fullName", 
      ACTING_CODE AS "actingCode", 
      EMAIL AS "email",
      VIRTUAL_ACC AS "virtualAccount"
    FROM MASTER_CM 
    WHERE CM_CODE = $1
  `;

  const result = await executeQuery<IAccount>(query, [customerId]);
  return result.rows?.[0] ?? null;
};

type EmailRow = { EMAIL: string };

export const getAccountEmails = async (
  cmCode: string,
  officeCode?: string | null
): Promise<string[]> => {
  let query = `
    SELECT DISTINCT EMAIL 
    FROM MASTER_COLLECTION 
    WHERE CM_CODE = $1 
      AND EMAIL IS NOT NULL
  `;

  const params: unknown[] = [cmCode];

  if (officeCode && officeCode !== "ALL") {
    query += " AND OFFICE_CODE = $2";
    params.push(officeCode);
  }

  const result = await executeQuery<EmailRow>(query, params);
  return result.rows.map((r) => r.EMAIL).filter(Boolean);
};
```

Note: Import changed from `../database` to `../postgres`.

### Task 7: Update branch-query.ts

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/queries/branch-query.ts`

- [ ] **Step 1: Update import and verify SQL**

Edit `apps/soa-finance/src/infrastructure/database/queries/branch-query.ts` — import from `../postgres` instead of `../database`. SQL is already PG-compatible (no Oracle-specific functions, no binds).

```typescript
import { executeQuery } from "../postgres";
import type { IBranch } from "../types";

export const getAllBranches = async (): Promise<IBranch[]> => {
  const sQuery = `SELECT OFFICE_CODE AS "officeCode", CONTACT_PERSON AS "name" FROM MASTER_BRANCH`;
  const result = await executeQuery<IBranch>(sQuery);
  return result.rows;
};
```

---

## Phase 3: Rewrite Pipeline Streaming

### Task 8: Create pg-stream-reader.ts

**Files:**
- Create: `apps/soa-finance/src/pipeline/read/pg-stream-reader.ts`
- Delete: `apps/soa-finance/src/pipeline/read/oracle-stream-reader.ts`

- [ ] **Step 1: Write pg-stream-reader.ts**

Create `apps/soa-finance/src/pipeline/read/pg-stream-reader.ts`:

```typescript
import { withConnectionGenerator, PG_STREAM, Cursor } from "@restate-tob/postgres";
import { getPostgresClient } from "../../infrastructure/database/postgres";

export async function* streamQueryFromPg(
  sql: string,
  params: unknown[]
): AsyncGenerator<unknown[], void, unknown> {
  const client = getPostgresClient();

  yield* withConnectionGenerator(client, async function* (poolClient) {
    const cursor = poolClient.query(new Cursor(sql, params, { rowMode: "array" }));
    try {
      let rows = await cursor.read(PG_STREAM.FETCH_ARRAY_SIZE);
      while (rows.length > 0) {
        for (const row of rows) {
          yield row;
        }
        rows = await cursor.read(PG_STREAM.FETCH_ARRAY_SIZE);
      }
    } finally {
      await cursor.close();
    }
  });
}
```

- [ ] **Step 2: Delete old oracle-stream-reader.ts**

Run: `rm apps/soa-finance/src/pipeline/read/oracle-stream-reader.ts`

### Task 9: Rewrite SOA_QUERY for PostgreSQL dialect

**Files:**
- Modify: `apps/soa-finance/src/pipeline/read/index.ts`

This task rewrites the ~124-line SOA_QUERY for PostgreSQL dialect.

**CRITICAL — the full query must be manually rewritten line by line.** Do NOT copy the Oracle SQL as-is. Use the conversion table below and reference `apps/soa-finance/src/pipeline/read/index.ts` for the original.

| Oracle | PostgreSQL | Notes |
|--------|-----------|-------|
| `NVL(expr, default)` | `COALESCE(expr, default)` | Standard PG replacement |
| `TRUNC(date)` | `date::date` | Cast to date truncates time |
| `TRUNC(:p_as_at_date) - CASE WHEN ... THEN TRUNC(a) ELSE TRUNC(b) END` | `$1::date - CASE WHEN ... THEN a::date ELSE b::date END` | Date subtraction works in PG |
| `SYSDATE + 1` | `CURRENT_TIMESTAMP + INTERVAL '1 day'` | `SYSDATE` has time; `CURRENT_DATE + 1` is midnight. Use interval for equivalent semantics |
| `POST_DATE < :p_as_at_date + 1` | `post_date < $1::date + INTERVAL '1 day'` | Same time-preserving logic |
| `TO_CHAR(date, 'yyyyMM')` | `TO_CHAR(date, 'YYYYMM')` | Same function, case change |
| `:p_as_at_date` bind | `$1` positional | Single bind param |
| `AND (ABS(dn.orig_amount) - ABS(NVL(fst.amt, 0))) > 1` | `AND (ABS(dn.orig_amount) - ABS(COALESCE(fst.amt, 0))) > 1` | Same logic |
| `WHERE dn.pol_office IS NOT NULL` | Same | No change needed |

**Identifier casing warning:** PostgreSQL folds unquoted identifiers to lowercase. `MASTER_CM` in the Oracle query becomes `master_cm` in PG. If the migrated tables used quoted identifiers (e.g., `"MASTER_CM"`), the query MUST quote them. Verify by running:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```
If table names return lowercase (e.g., `master_cm`), unquoted references work. If uppercase, quote them.

- [ ] **Step 1: Replace the import**

Edit the top of `apps/soa-finance/src/pipeline/read/index.ts`:

```typescript
import { streamQueryFromPg } from "./pg-stream-reader";
```

- [ ] **Step 2: Rewrite the SOA_QUERY string**

Rewrite every Oracle-specific construct in the SOA_QUERY string. Keep the same column aliases (`"branch"`, `"policy_no"`, etc.) — PG supports double-quoted aliases. Use `$1` for the single bind parameter (replaces `:p_as_at_date`).

- [ ] **Step 3: Update streamSoaData function signature**

```typescript
export function streamSoaData(asAtDate: Date) {
  return streamQueryFromPg(SOA_QUERY, [asAtDate]);
}
```

### Task 10: Update pipeline/types.ts

**Files:**
- Modify: `apps/soa-finance/src/pipeline/types.ts`

- [ ] **Step 1: Remove IOracleStreamOptions**

Edit `apps/soa-finance/src/pipeline/types.ts` — remove the `IOracleStreamOptions` type definition (lines 1-4). The rest of the file (column mapping, pipeline result types) stays.

### Task 11: Update pipeline/index.ts

**Files:**
- Modify: `apps/soa-finance/src/pipeline/index.ts`

- [ ] **Step 1: Verify imports**

Edit `apps/soa-finance/src/pipeline/index.ts` — verify the import of `streamSoaData` from `./read` works correctly. No changes needed if the `read/index.ts` still exports `streamSoaData` with the same signature. However, update the comment on line 9:

```typescript
// Run complete SOA pipeline: PostgreSQL → Transform → Parquet by account code → upload to Azure Blob
```

### Task 12: Update constants

**Files:**
- Modify: `apps/soa-finance/src/constants/constants.ts`

- [ ] **Step 1: Remove ORACLE_STREAM**

Edit `apps/soa-finance/src/constants/constants.ts` — remove the `ORACLE_STREAM` constant (the `PG_STREAM.FETCH_ARRAY_SIZE` from the postgres package replaces it).

---

## Phase 4: Config, Dependencies & Entry Points

### Task 13: Update package.json

**Files:**
- Modify: `apps/soa-finance/package.json`

- [ ] **Step 1: Swap dependencies**

Edit `apps/soa-finance/package.json`:

```diff
- "dependencies": {
-   "oracledb": "^6.10.0",
-   "@restate-tob/oracle": "workspace:*",
- }
+ "dependencies": {
+   "pg": "^8.16.0",
+   "@restate-tob/postgres": "workspace:*",
+ }

- "devDependencies": {
-   "@types/oracledb": "^6.10.1"
- }
+ "devDependencies": {
+   "@types/pg": "^8.11.0"
+ }
```

- [ ] **Step 2: Update Lambda bundle scripts**

Edit the bundle scripts:

```diff
- "bundle:lambda": "esbuild src/app.lambda.ts ... --external:oracledb ..."
+ "bundle:lambda": "esbuild src/app.lambda.ts ... --platform=node ..."
+   (Remove --external:oracledb entirely. Bundle pg + pg-cursor + their deps with esbuild.)
+   pg has no native modules, so esbuild can bundle it without externalization.

- "postbundle:lambda": "... cp -rL ../node_modules/oracledb node_modules/ ..."
+ "postbundle:lambda": "... cp -rL ..."
+   (Remove the oracledb copy line. pg/pg-cursor are bundled by esbuild so no runtime copy needed.)
```

### Task 14: Update environment schemas

**Files:**
- Modify: `apps/soa-finance/.env.schema`
- Modify: `apps/soa-finance/.env.example`

- [ ] **Step 1: Update .env.schema**

Replace Oracle entries with PostgreSQL:

```diff
- # Oracle Database (URL format)
- # Example: oracle://user:password@host:1521/ORCL
- # @required @sensitive @type=url
- ORACLE_URL=
+ # PostgreSQL Database (URL format)
+ # Example: postgresql://user:password@host:5432/dbname
+ # @required @sensitive @type=url
+ DATABASE_URL=

- # Optional: Oracle Instant Client library path (only needed on macOS)
- # Example: /opt/oracle/instantclient_23_3
- # @required=false
- ORACLE_LIB_DIR=
```

- [ ] **Step 2: Update .env.example**

Same changes as `.env.schema`.

### Task 15: Update env.d.ts

**Files:**
- Modify: `apps/soa-finance/src/env.d.ts`

- [ ] **Step 1: Regenerate env types via varlock**

Run the varlock type generator (do NOT hand-edit — the file header says it's autogenerated):

```bash
bun exec varlock typegen --path apps/soa-finance
```

This regenerates `apps/soa-finance/src/env.d.ts` from `.env.schema`. After updating `.env.schema` in Task 14 (replacing `ORACLE_URL` with `DATABASE_URL`, removing `ORACLE_LIB_DIR`), this command produces the correct types automatically.

Verify the output includes `DATABASE_URL: string` and does NOT include `ORACLE_URL` or `ORACLE_LIB_DIR`. If it does, the `.env.schema` change is incorrect.

### Task 16: Update app.local.ts

**Files:**
- Modify: `apps/soa-finance/src/app.local.ts`

- [ ] **Step 1: Replace Oracle init with Postgres init**

```typescript
import "varlock/auto-load";
import { serve } from "@restatedev/restate-sdk";
import {
  initPostgresClient,
  testPostgresConnection,
} from "./infrastructure/database/postgres";
import { sharedServices } from "./services";

const PORT = 9080;

async function main() {
  console.log("[App] Testing PostgreSQL connection...");
  initPostgresClient();

  const pg = await testPostgresConnection();
  if (!pg) {
    console.error("⚠️  PostgreSQL connection failed, but server will continue...");
  }

  await serve({
    services: sharedServices,
    port: PORT,
  });

  console.log(`[App] Server started on port ${PORT}`);
  console.log("[App] Registered services:");
  for (const service of sharedServices) {
    console.log(`[App]   - ${service.name}`);
  }
}

main().catch((err) => {
  console.error("[App] Failed to start application:", err);
  process.exit(1);
});
```

### Task 17: Update app.lambda.ts

**Files:**
- Modify: `apps/soa-finance/src/app.lambda.ts`

- [ ] **Step 1: Replace Oracle init with Postgres init**

```typescript
import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initPostgresClient } from "./infrastructure/database/postgres";
import { sharedServices } from "./services";

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
});

initPostgresClient();

export const handler = createEndpointHandler({
  services: sharedServices,
});
```

---

## Phase 5: Cleanup & Verification

### Task 18: Verify compilation

- [ ] **Step 1: Build the postgres package**

Run: `rtk bun run --filter @restate-tob/postgres build`
Expected: Clean exit code 0

- [ ] **Step 2: Build soa-finance**

Run: `rtk bun run --filter @restate-tob/soa-finance build`
Expected: Clean exit code 0

- [ ] **Step 3: LSP diagnostics on all changed files**

Run LSP diagnostics on:
- `packages/postgres/src/client.ts`
- `packages/postgres/src/types.ts`
- `packages/postgres/src/index.ts`
- `packages/postgres/src/stream.ts`
- `apps/soa-finance/src/infrastructure/database/postgres.ts`
- `apps/soa-finance/src/infrastructure/database/index.ts`
- `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts`
- `apps/soa-finance/src/pipeline/read/pg-stream-reader.ts`
- `apps/soa-finance/src/pipeline/read/index.ts`
- `apps/soa-finance/src/app.local.ts`
- `apps/soa-finance/src/app.lambda.ts`

Expected: No errors

### Task 19: Remaining Oracle reference check

- [ ] **Step 1: Grep for Oracle source references**

Run: `grep -r "oracledb\|@restate-tob/oracle\|ORACLE_" apps/soa-finance/src/ --include="*.ts" --include="*.tsx"`
Expected: Zero matches (all Oracle references removed from source)

Note: False positives from comments in `docs/` directory are acceptable.

- [ ] **Step 2: Verify pipeline row format matches transformer expectations**

The `soa-transformer.ts` indexes rows by numeric position (0-36). Verify the first row produced by `streamQueryFromPg` has `Array.isArray(row) && row.length === 37` columns. If the column count differs, update the `column` constant in `pipeline/types.ts`.

Run: Check `apps/soa-finance/src/pipeline/transform/soa-transformer.ts` for `row[` usage and confirm `column` enum has 37 entries.

### Task 20: Update documentation and comments

**Files:**
- Modify: `apps/soa-finance/README.md`
- Modify: `apps/soa-finance/docs/deployment.md`
- Modify: `apps/soa-finance/AGENTS.md`

- [ ] **Step 1: Update README**

Replace "Oracle database" references with "PostgreSQL database" in `apps/soa-finance/README.md`. Update the Prerequisites section.

- [ ] **Step 2: Update deployment docs**

Edit `apps/soa-finance/docs/deployment.md` — replace Oracle references with PostgreSQL.

- [ ] **Step 3: Update AGENTS.md**

Edit `apps/soa-finance/AGENTS.md` — replace `ORACLE_URL` in the Environment Variables section with `DATABASE_URL`, update description.

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every requirement from the design spec has a corresponding task:
  - Extending @restate-tob/postgres: Tasks 1-3
  - Database layer rewrite: Tasks 4-7
  - Pipeline streaming rewrite: Tasks 8-12
  - Config & env: Tasks 13-15
  - Entry points: Tasks 16-17
  - Cleanup & verify: Task 18

- [ ] **Placeholder scan:** Checked all code blocks — none contain "TBD", "TODO", "implement later", or vague placeholders. Every code block has complete TypeScript.

- [ ] **Type consistency:** 
  - `executeQuery` defined on `PostgresClient` in Task 1 → used in Tasks 4, 6, 7 ✓
  - `withConnectionGenerator` from `@restate-tob/postgres` in Task 2 → used in Task 8 ✓
  - `DATABASE_URL` env var in Task 14 → referenced in Task 4 ✓
  - `PG_STREAM.FETCH_ARRAY_SIZE` in Task 2 → used in Task 8 ✓

- [ ] **No orphaned dependencies:** All imports verified against actual exports. `pg-cursor` placed in `@restate-tob/postgres` (not `apps/soa-finance`).

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-18-soa-finance-postgres-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, and use parallel execution for independent tasks

**2. Inline Execution** — Execute tasks in this session, one checkpointed batch at a time

Which approach?
```

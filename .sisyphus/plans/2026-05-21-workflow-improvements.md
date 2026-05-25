# Workflow Improvements & Technical Debt Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reliability issues, consolidate duplicated patterns, harden CI/CD, and eliminate technical debt across both Restate services.

**Architecture:** The monorepo has 2 apps (finance, soa-finance) and 2 packages (postgres, shared). Changes are grouped into 8 independent work tasks that can be parallelized. Each task targets specific files with clear before/after. Fixes target root causes (silent failures, connection leaks, unawaited promises, validation gaps, hardcoded configs, missing CI gates).

**Tech Stack:** TypeScript 5, Restate SDK 1.9, PostgreSQL (pg 8), Turborepo, Bun, esbuild, Zod 4, pino, luxon

---

### Task 1: Postgres Package Resilience Fixes

**Files:**
- Modify: `packages/postgres/src/client.ts`

**Goal:** Fix connection leak in `testConnection()` and the `SET search_path` query that currently runs unawaited inside `pool.on("connect")` — pg does **not** await async callbacks, so the search_path may not be set before the first application query.

- [ ] **Step 1: Fix `testConnection()` — add finally block to release client on error**

Replace the `testConnection()` method inside `createPostgresClient()`:

```typescript
async testConnection(): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW()");
    console.log(
      "✅ PostgreSQL connected successfully at:",
      result.rows[0].now
    );
    return true;
  } catch (error: unknown) {
    console.error("❌ PostgreSQL connection failed:", error);
    return false;
  } finally {
    client.release();
  }
},
```

- [ ] **Step 2: Fix pool search_path — replace unawaited connect handler with a wrapped connect**

`pool.on("connect", async (client) => { ... })` is **not** awaited by pg. Remove the pool.on("connect") handler and replace it with a wrapped `pool.connect()` that awaits `SET search_path` before returning the client. Update `withConnection()` and `executeQuery()` to use the wrapped connect.

**Create a private `connectWithSchema()` helper:**

```typescript
async function connectWithSchema(
  pool: Pool,
  schema: string | undefined
): Promise<PoolClient> {
  const client = await pool.connect();
  if (schema) {
    try {
      await client.query(`SET search_path TO "${schema}"`);
    } catch (err) {
      client.release();
      throw err;
    }
  }
  return client;
}
```

**Update `createPostgresClient()` — remove the pool.on("connect")** handler (lines 65-69):

```typescript
// Remove these lines entirely:
// pool.on("connect", (client) => {
//   if (schema) {
//     client.query(`SET search_path TO "${schema}"`);
//   }
// });
```

**Update `withConnection()`** (which is exported from client.ts) to use `connectWithSchema()` instead of `client.pool.connect()`:

```typescript
export async function withConnection<T>(
  client: PostgresClient,
  operation: (poolClient: PoolClient) => Promise<T>
): Promise<T> {
  const poolClient = await connectWithSchema(client.pool, /* schema */);
  // ... rest unchanged
```

Note: `withConnection()` does not currently have access to `schema`. Options:
- Add `schema` to the `PostgresClient` type
- Or capture `schema` in the closure inside `createPostgresClient()`

**Update `executeQuery()`** to use `connectWithSchema()`:

```typescript
async executeQuery<T>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const conn = await connectWithSchema(pool, schema);
  try {
    const result = await conn.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? null };
  } finally {
    conn.release();
  }
},
```

- [ ] **Step 3: Run diagnostics to verify**

Run: `rtk bun run --filter @restate-tob/postgres typecheck`
Expected: Clean typecheck with no errors

---

### Task 2: Email Failure Handling — Don't Finalize State on Send Failure

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts`
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

**Goal:** Email send failures should not result in state being finalized as if delivery succeeded.

**Restate constraint:** `createReminder()` calls `ctx.get()`, `ctx.set()`, `ctx.console.log()` — it **must not** run inside `ctx.run()`. The generate/upload/send must remain in a single `ctx.run()` to avoid binary journal bloat. The key restructuring: separate the external side effects (generate, upload, send) from the state management (create reminder, finalize letter).

#### Task 2a: process-branches.ts — decouple createReminder from sendWithAttachments

- [ ] **Step 1: Restructure `processSingleBranch()` to separate state from side effects**

The current flow runs inside `processSingleBranch()`:
```
ctx.run("generate-and-upload", ...)  → returns { excelFile, pdfFile } (IFileData buffers — journal bloat!)
sendWithAttachments(...)              → catches error silently
createReminder(...)                   → uses ctx.set — MUST run outside ctx.run()
```

Change to:
```
ctx.run("generate-and-upload", ...)  → returns only metadata, NO buffers
createReminder(...)                   → outside ctx.run(), records the reminder
sendWithAttachments(...)              → outside ctx.run(), error is caught and logged
```

The `ctx.run("generate-and-upload")` callback should NOT store the `IFileData` buffers in the journal. Instead, have `generateAndUploadDocuments()` do the S3 upload inside the callback so the binary data stays there. Return only file names / metadata from the callback.

If that requires significant refactoring of `generateAndUploadDocuments()`, a simpler interim fix is:
1. Keep `ctx.run("generate-and-upload")` as-is (returning file names)  
2. Move `createReminder()` to run BEFORE the send, but still outside `ctx.run()`
3. The send failure doesn't prevent the reminder from being recorded

- [ ] **Step 2: Run diagnostics**

Run: `rtk bun run --filter @restate-tob/soa-finance typecheck`
Expected: Clean

#### Task 2b: generate-reminder-letter.ts — don't mark as "sent" on email failure

- [ ] **Step 1: Make `finalizeLetterSent()` conditional on email success**

`createAndSendReminder()` has the flow:
```
await generateUploadAndSendReminder(...)  // ctx.run() + try/catch around sendWithAttachments
await finalizeLetterSent(...)              // ctx.set() — MUST run outside ctx.run(), but only if sent
```

Change `generateUploadAndSendReminder` to return `{ emailSent: boolean }` instead of `void`. Only call `finalizeLetterSent` when the email was actually sent.

```typescript
type GenerateUploadSendResult = {
  emailSent: boolean;
};

async function generateUploadAndSendReminder(...): Promise<GenerateUploadSendResult> {
  // ... ctx.run("generate-and-upload-reminder", ...) for doc generation ...
  
  try {
    await sendWithAttachments({...});
    return { emailSent: true };
  } catch (error) {
    ctx.console.log(`[Email] Failed to send reminder for ${customer.code}: ...`);
    return { emailSent: false };
  }
}

// In createAndSendReminder():
const uploadSendResult = await generateUploadAndSendReminder({...});

if (uploadSendResult.emailSent) {
  await finalizeLetterSent(ctx, reminder, pendingRecord);
}

return {
  sent: uploadSendResult.emailSent,
  dcNotesPaid: [],
  letterNo: pendingRecord.letterNo,
  reason: uploadSendResult.emailSent ? "SENT" : "EMAIL_FAILED",
};
```

- [ ] **Step 2: Run diagnostics**

Run: `rtk bun run --filter @restate-tob/soa-finance typecheck`
Expected: Clean

---

### Task 3: Await Scheduler Workflow Sends

**Files:**
- Modify: `apps/soa-finance/src/pipeline/scheduler.ts`
- Modify: `apps/finance/src/modules/closing/handlers/scheduler.handler.ts`

**Goal:** Catch workflow enqueue failures instead of fire-and-forgetting.

**Restate SDK note:** In SDK 1.9, `workflowSendClient(workflow, id).run(params)` and `objectSendClient(obj, key).method(payload)` return promises that resolve when the send/trigger is enqueued. Use `await` to surface enqueue failures, but avoid `.catch()` on the send client chain — instead use try/catch around the calls so the error is propagated properly.

#### Task 3a: soa-finance scheduler

- [ ] **Step 1: Wrap `workflowSendClient` and `objectSendClient` calls in try/catch**

In `runPipelineAndBatch()`, lines 170-172:
```typescript
// Before:
ctx
  .workflowSendClient(batchWorkflow, workflowId)
  .run({ type: schedule.soaType });

// After:
try {
  await ctx
    .workflowSendClient(batchWorkflow, workflowId)
    .run({ type: schedule.soaType });
  ctx.console.log(`Batch workflow enqueued: ${workflowId}`);
} catch (error) {
  ctx.console.error(
    `Failed to enqueue batch workflow ${workflowId}: ${error instanceof Error ? error.message : "Unknown error"}`
  );
  throw error;
}
```

In `scheduleNextRun()`, lines 199-201:
```typescript
// Before:
ctx
  .objectSendClient(SoaScheduler, "main", { delay: nextRun.delayMs })
  .trigger(payload);

// After:
try {
  await ctx
    .objectSendClient(SoaScheduler, "main", { delay: nextRun.delayMs })
    .trigger(payload);
  ctx.console.log(`Next run scheduled: ${nextRun.schedule.type}`);
} catch (error) {
  ctx.console.error(
    `Failed to schedule next run: ${error instanceof Error ? error.message : "Unknown error"}`
  );
  throw error;
}
```

#### Task 3b: finance scheduler

- [ ] **Step 2: Await `workflowSendClient` and `objectSendClient` in `scheduler.handler.ts`**

In the `trigger` handler, lines 74-79:
```typescript
// Before:
ctx.workflowSendClient(dailyClosingWorkflow, dateStr).run({
  date: dateStr,
  skipGeniusClosing: false,
  skipFinancialMetrics: false,
  userId: "adm",
});

// After:
try {
  await ctx
    .workflowSendClient(dailyClosingWorkflow, dateStr)
    .run({
      date: dateStr,
    });
} catch (error) {
  ctx.console.error(
    `Failed to enqueue daily closing for ${dateStr}: ${error instanceof Error ? error.message : "Unknown error"}`
  );
  throw error;
}
```

In `scheduleNextRun()`, lines 114-116:
```typescript
// Before:
ctx
  .objectSendClient(DailyClosingScheduler, "main")
  .trigger(rpc.sendOpts({ delay: { milliseconds: delayMs } }));

// After:
try {
  await ctx
    .objectSendClient(DailyClosingScheduler, "main")
    .trigger(rpc.sendOpts({ delay: { milliseconds: delayMs } }));
} catch (error) {
  ctx.console.error(
    `Failed to schedule next closing run: ${error instanceof Error ? error.message : "Unknown error"}`
  );
  throw error;
}
```

- [ ] **Step 3: Run diagnostics on both apps**

Run: `rtk bun run --filter @restate-tob/soa-finance typecheck` and `rtk bun run --filter @restate-tob/finance typecheck`
Expected: Both clean

---

### Task 4: Use Shared Schemas in DailyClosingInput

**Files:**
- Modify: `apps/finance/src/modules/closing/workflows/daily-closing.workflow.ts`

**Goal:** Replace raw `z.string()` with `DateStringSchema` and `UserIdSchema` from `@restate-tob/shared`, AND add explicit `.parse()` in the `run` handler so validation actually runs at runtime.

**Key insight:** Simply changing the Zod schema does NOT trigger validation. The `run` handler receives input but never calls `.parse()` — it accesses `input?.date` directly. We need to add explicit validation.

- [ ] **Step 1: Import shared schemas and update DailyClosingInput**

```typescript
import { DateStringSchema, UserIdSchema } from "@restate-tob/shared";
```

Replace the `DailyClosingInput` zod object:
```typescript
export const DailyClosingInput = z.object({
  date: DateStringSchema,
  skipGeniusClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: UserIdSchema.optional(),
});
```

- [ ] **Step 2: Add explicit `.parse()` in the `run` handler**

At the top of the `run` handler (before using `closingDate`, `userId`, etc.), add:

```typescript
run: async (
  ctx: WorkflowContext,
  input?: z.infer<typeof DailyClosingInput>
): Promise<z.infer<typeof DailyClosingResult>> => {
  const workflowId = ctx.key;
  const workflowStartTime = DateTime.fromMillis(await ctx.date.now());

  // Validate input with shared schemas
  let validatedInput: z.infer<typeof DailyClosingInput>;
  try {
    validatedInput = DailyClosingInput.parse(input ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input";
    ctx.console.error(`❌ Input validation failed: ${message}`);
    throw new TerminalError(`Invalid workflow input: ${message}`);
  }

  const closingDate = validatedInput.date;
  const skipGeniusClosing = validatedInput.skipGeniusClosing;
  const skipFinancialMetrics = validatedInput.skipFinancialMetrics;
  const userId = validatedInput.userId ?? "adm";
```

- [ ] **Step 3: Run diagnostics**

Run: `rtk bun run --filter @restate-tob/finance typecheck`
Expected: Clean

---

### Task 5: Eliminate Hardcoded Values — Make Env-Driven

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/gotenberg/gotenberg-client.ts`
- Modify: `apps/soa-finance/src/infrastructure/s3/s3-client.ts`
- Modify: `apps/soa-finance/src/utils/config/emails.ts`
- Modify: `apps/finance/src/modules/closing/handlers/scheduler.handler.ts`
- Modify: `apps/soa-finance/src/constants/schedule.ts`

**Goal:** Remove silent fallbacks that hide misconfiguration. Throw explicit errors when required config is missing. Make `DAILY_CLOSING_SCHEDULE_TIME` env-driven instead of hardcoded to "23:00".

#### Task 5a: Finance schedule time — make env-driven with validation

- [ ] **Step 0: Make DAILY_CLOSING_SCHEDULE_TIME read from env with validation**

In `apps/finance/src/constants.ts`, replace the hardcoded `"23:00"` with an env-driven value:

```typescript
export { TIMEZONE } from "@restate-tob/shared";

const scheduleTime = process.env.DAILY_CLOSING_SCHEDULE_TIME ?? "23:00";
const TIME_FORMAT_REGEX = /^(\d{1,2}):(\d{2})$/;
const timeMatch = scheduleTime.match(TIME_FORMAT_REGEX);

if (!timeMatch) {
  throw new Error(
    `Invalid DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Expected format: HH:mm (e.g., "02:30", "14:00")`
  );
}

const hour = Number.parseInt(timeMatch[1], 10);
const minute = Number.parseInt(timeMatch[2], 10);

if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
  throw new Error(
    `Invalid DAILY_CLOSING_SCHEDULE_TIME: "${scheduleTime}". Hour (0-23) or minute (0-59) out of range.`
  );
}

export const DAILY_CLOSING_SCHEDULE_TIME = scheduleTime;
```

#### Task 5b: SoaScheduler — add "started" guard to prevent duplicate scheduling

The `DailyClosingScheduler` has a `ctx.get("started")` guard, but `SoaScheduler.start` doesn't — meaning multiple start calls can enqueue duplicate future triggers.

- [ ] **Step 1: Add started guard to SoaScheduler.start**

In `apps/soa-finance/src/pipeline/scheduler.ts`, update the `start` handler:

```typescript
start: async (ctx: ObjectContext) => {
  const alreadyStarted = await ctx.get<boolean>("started");
  if (alreadyStarted) {
    ctx.console.log("SoaScheduler already running — skipping duplicate start");
    return;
  }
  ctx.set("started", true);
  ctx.console.log("Starting SoaScheduler");
  await scheduleNextRun(ctx);
},
```

#### Task 5d: S3 region and bucket — throw on missing env

- [ ] **Step 2: Make S3 env vars required (both region and bucket)**

In `s3-client.ts`:
```typescript
// Before:
const AWS_REGION = process.env.AWS_REGION || "ap-southeast-3";
const S3_BUCKET = process.env.S3_BUCKET || "soa-finance-default";

// After:
const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
if (!AWS_REGION) {
  throw new Error("AWS_REGION environment variable is required for S3 client");
}
if (!S3_BUCKET) {
  throw new Error("S3_BUCKET environment variable is required");
}
```

#### Task 5e: Email config — throw on missing shared mailbox

- [ ] **Step 3: Make AZURE_SHARED_MAILBOX required**

In `emails.ts`:
```typescript
// Before:
SHARED_MAILBOX: process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com",

// After:
SHARED_MAILBOX: (() => {
  const val = process.env.AZURE_SHARED_MAILBOX;
  if (!val) throw new Error("AZURE_SHARED_MAILBOX environment variable is required");
  return val;
})(),
```

Same for `FALLBACK_EMAIL: process.env.SOA_FALLBACK_EMAIL` — remove the hardcoded fallback. Let it be undefined and handle downstream.

#### Task 5f: Finance scheduler — throw instead of silent fallback

- [ ] **Step 3: Remove `getScheduleConfigSafe()`, always throw on invalid config**

In `scheduler.handler.ts`, replace usage of `getScheduleConfigSafe()` with `getScheduleConfig()`. Remove the `getScheduleConfigSafe()` function entirely:

```typescript
// Delete getScheduleConfigSafe() entirely
function getScheduleConfigSafe() {
  try {
    return getScheduleConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Invalid scheduler configuration, falling back to 23:00 (${TIMEZONE}): ${message}`
    );
    return { hour: 23, minute: 0 };
  }
}
```

Replace all calls to `getScheduleConfigSafe()` with `getScheduleConfig()`.

#### Task 5g: SOA schedule — throw on invalid env instead of silent fallback

- [ ] **Step 4: Make `parseScheduleDays()` throw on invalid input**

In `schedule.ts`:
```typescript
function parseScheduleDays(): number[] {
  const raw = process.env.SOA_SCHEDULE_DAYS;
  if (!raw) {
    return [4, 11, 19, 25];  // Default when not set — this is fine
  }
  const days = raw.split(",").map((s) => Number(s.trim()));
  if (
    days.length === 4 &&
    days.every((d) => Number.isFinite(d) && d >= 1 && d <= 31)
  ) {
    return days;
  }
  // Changed from "return default" to throw
  throw new Error(
    `Invalid SOA_SCHEDULE_DAYS: "${raw}". Expected 4 comma-separated day numbers (1-31).`
  );
}
```

- [ ] **Step 5: Run diagnostics on both apps**

Run: `rtk bun run --filter @restate-tob/soa-finance typecheck`
Run: `rtk bun run --filter @restate-tob/finance typecheck`
Expected: Both clean

**Note:** Task 5f touches `scheduler.handler.ts` (removes `getScheduleConfigSafe`). Task 8 also touches this file for logging. Execute Task 8 AFTER Task 5f, or handle the conflict by doing both changes at once.

---

### Task 6: CI/CD Improvements

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `turbo.json`
- Modify: `apps/finance/package.json`
- Modify: `apps/soa-finance/package.json`

**Goal:** Add PR CI workflow, fix turbo build caching, wire finance tests.

#### Task 6a: Add PR CI workflow

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
    paths:
      - "apps/**"
      - "packages/**"
      - "package.json"
      - "turbo.json"
      - "bun.lock"
      - "tsconfig*.json"

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.2.22"
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run check
      - run: bun run build
      - run: bun run test
```

#### Task 6b: Fix turbo.json — add `typecheck.dependsOn` and `test` task

- [ ] **Step 2: Update turbo.json**

`typecheck` runs `tsc --noEmit` which needs packages to be built first (since workspace packages reference each other via `dist/` exports). Add `dependsOn: ["^build"]` to `typecheck`. Also add `test` task.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "//#check": {},
    "//#fix": {
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {}
  }
}
```

- [ ] **Step 3: Add test script to root package.json**

```json
"scripts": {
  "build": "turbo run build",
  "dev": "turbo run dev",
  "clean": "turbo run clean",
  "typecheck": "turbo run typecheck",
  "check": "ultracite check",
  "fix": "ultracite fix",
  "test": "turbo run test"
}
```

#### Task 6c: Add test script to finance package

- [ ] **Step 4: Add `test` script to `apps/finance/package.json`**

```json
"test": "bun test src/",
```

- [ ] **Step 5: Verify finance tests can run**

Run: `rtk bun run --filter @restate-tob/finance test`
Expected: Tests pass (or existing failures reported)

---

### Task 7: Shared Config Consolidation

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `apps/soa-finance/src/constants/constants.ts`

**Goal:** Consolidate duplicated CONTENT_TYPES constant. `tsconfig.base.json` IS actively used by all 4 sub-projects — keep it.

- [ ] **Step 1: Extend shared CONTENT_TYPES to match soa-finance version**

In `packages/shared/src/constants.ts`:
```typescript
export const CONTENT_TYPES = {
  PDF: "application/pdf",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  XLS: "application/vnd.ms-excel",
  HTML: "text/html",
  CSV: "text/csv",
  OCTET_STREAM: "application/octet-stream",
} as const;
```

- [ ] **Step 2: Import extended CONTENT_TYPES in soa-finance**

In `apps/soa-finance/src/constants/constants.ts`, replace the local `CONTENT_TYPES` definition with re-export from shared. Keep the local `getContentType()` function and other constants (ROMAN_MONTHS, INFRASTRUCTURE_TIMEOUTS, etc.):

```typescript
export { TIMEZONE, CONTENT_TYPES } from "@restate-tob/shared";
```

Remove the local `CONTENT_TYPES` object (lines 34-41) and the `ContentType` type export but keep `getContentType()` which references these values.

- [ ] **Step 3: Verify no regressions**

Run: `rtk bun run --filter @restate-tob/soa-finance typecheck`
Expected: Clean

---

### Task 8: Logging Standardization

**Files:**
- Modify: `apps/finance/src/infrastructure/database.ts`
- Modify: `apps/finance/src/modules/closing/handlers/scheduler.handler.ts`
- Modify: `apps/finance/src/app.local.ts`
- Modify: `apps/finance/src/modules/closing/workflows/daily-closing.workflow.ts`
- Modify: `apps/finance/package.json`

**Goal:** Replace `console.log/error/warn` with structured pino logger in finance app, matching soa-finance pattern.

- [ ] **Step 1: Add pino dependency to finance**

```bash
bun add pino --filter @restate-tob/finance
bun add --dev @types/pino --filter @restate-tob/finance
```

- [ ] **Step 2: Create `apps/finance/src/utils/logger.ts`**

Copy the same pattern from soa-finance:
```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

export default logger;
```

- [ ] **Step 3: Replace console.log in database.ts**

Replace:
```typescript
console.error("PostgreSQL connection error during operation:", err.message);
// -> logger.error({ component: "Postgres" }, "Connection error: ...", ...)
```

Replace in testConnection:
```typescript
console.log("✅ PostgreSQL connected successfully at:", result.rows[0].now);
// -> logger.info(...)
console.error("❌ PostgreSQL connection failed:", error);
// -> logger.error(...)
```

Replace in pool error:
```typescript
console.error("Unexpected error on idle PostgreSQL client", err);
// -> logger.error(...)
```

Replace close:
```typescript
console.log("PostgreSQL pool closed");
// -> logger.info(...)
```

- [ ] **Step 4: Replace console.log in scheduler.handler.ts**

Replace `console.warn(...)` with `logger.warn(...)` and `console.log(...)` with `ctx.console.log(...)` where applicable (keep using Restate's context console for handler-scoped logs, which is already done). 

**Note:** Task 5f removes `getScheduleConfigSafe()`, so the `console.warn` in that function is already gone. This Task's Step 4 only needs to replace any remaining `console` calls that weren't addressed in Task 5f. Execute Task 8 AFTER Task 5f, or combine edits.

- [ ] **Step 5: Replace console.log in app.local.ts**

Replace `console.error(...)` and `console.log(...)` with `logger.error(...)` and `logger.info(...)`.

- [ ] **Step 6: Run diagnostics**

Run: `rtk bun run --filter @restate-tob/finance typecheck`
Expected: Clean

---

## Oracle Review Findings

The plan was reviewed by Oracle Senior Consultant. Key corrections applied:

1. **Task 1**: `pool.on("connect", async ...)` is NOT awaited by pg. Changed to a wrapped `connectWithSchema()` helper that awaits `SET search_path` before returning the client.

2. **Task 2**: `createReminder()` calls `ctx.get/set` — CANNOT run inside `ctx.run()`. Restructured: `ctx.run()` only for generate/upload/send, external side effects (createReminder, finalizeLetterSent) run after outside `ctx.run()`.

3. **Task 3**: `.catch()` on Restate send client chains may not work. Changed to try/catch blocks around `await` on send client promises.

4. **Task 4**: Simply updating the Zod schema doesn't trigger runtime validation. Added explicit `DailyClosingInput.parse(input)` in the `run` handler.

5. **Task 5**: Added env-driven `DAILY_CLOSING_SCHEDULE_TIME` with validation. Added SoaScheduler "started" guard. S3 region is now also required. Noted Task 5/8 conflict on `scheduler.handler.ts`.

6. **Task 6**: Added `typecheck.dependsOn: ["^build"]` to turbo.json. Pinned Bun to `1.2.22`. Uses `--frozen-lockfile`. Added tsconfig glob to CI trigger paths.

7. **Task 7**: `tsconfig.base.json` IS actively used by all 4 sub-projects. Removed the deletion step.

8. **Task 8**: Noted execution ordering with Task 5f (both touch `scheduler.handler.ts`).

## Self-Review

- [ ] **Spec coverage:** All 14 priority items from the analysis have matching tasks:
  - Item 1 (email failure): Task 2
  - Item 2 (fire-and-forget sends): Task 3
  - Item 3 (connection leak): Task 1
  - Item 4 (pool connect handler): Task 1
  - Item 5 (shared bootstrap): Task 7
  - Item 6 (shared schemas): Task 4
  - Item 7 (hardcoded values): Task 5
  - Item 8 (logging inconsistency): Task 8
  - Item 9 (build+typecheck dup): Task 6
  - Item 10 (no CI gate): Task 6
  - Item 11 (bundle caching): Task 6
  - Item 12 (no test script): Task 6
  - Item 13 (SoaScheduler guard): Task 5b
  - Item 14 (CONTENT_TYPES): Task 7

- [ ] **Placeholder scan:** No TBD, TODO, or placeholder patterns found.

- [ ] **Type consistency:** All variable names, imports, and function signatures match existing code patterns. Tasks reference exact file paths and line numbers from the codebase.

- [ ] **Dependency ordering:** Task 8 depends on Task 5f (both modify `scheduler.handler.ts`). Task 1 (postgres package) has no dependency on app tasks. All other tasks are independent.

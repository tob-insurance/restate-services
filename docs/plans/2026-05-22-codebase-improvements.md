# Codebase Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate critical reliability bugs, reduce tech debt, and improve test coverage across the finance and soa-finance apps.

**Architecture:** Improvements grouped into 7 phases by business impact: (1) Critical Durability Fixes — email replay, false success, leaked state; (2) Reliability — deterministic timestamps, RestatePromise, magic numbers; (3) Decomposition — split god files; (4) Dead Code & Deps — prune unused code and dependencies; (5) Architecture Cleanup — consolidate DB wrappers, remove barrel files, extract SQL; (6) Test Infrastructure — fix broken tests, add integration tests; (7) Polish — catch typing, import consistency, scheduler race conditions.

**Tech Stack:** TypeScript 5.x, Restate SDK 1.9.x, Bun, Turborepo, PostgreSQL, Zod, Pino

---

## Deployment Safety Note (READ FIRST)

**Critical:** Tasks 1-2 change `ctx.run()` names and journal shapes. Deploying these changes in-place will break **in-flight Restate invocations** — the runtime has journal entries with old names and cannot find matching handlers for the new names. 

**Must do:** Use immutable deployment (new version) or drain active SOA/reminder invocations before deploying these changes. During development/testing on local Restate, clear the journal by restarting.

---

## File Inventory

### Critical Fixes (Phase 1)
| File | Change |
|------|--------|
| `apps/soa-finance/src/modules/soa/services/process-branches.ts` | Keep generate+upload+send in ONE `ctx.run()`, move `createReminder()` after successful email, propagate failures |
| `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` | Same pattern — single `ctx.run()` for gen+upload+send, fix leaked letter state on failure |
| `apps/finance/src/modules/closing/services/genius-closing.service.ts` | Fix empty `catch {}` block, ensure session cleanup |
| `apps/finance/src/modules/closing/workflows/daily-closing.workflow.test.ts` | Fix broken date format test |

### Reliability (Phase 2)
| File | Change |
|------|--------|
| `apps/finance/src/modules/financial-metrics/services/metrics.service.ts` | Remove `DateTime.now()`, use passed-in `currentTimeMillis` |
| `apps/finance/src/modules/trial-balance-sync/sync.service.ts` | Remove `new Date()` fallback in all 3 locations (lines 61, 215, 228) |
| `apps/soa-finance/src/infrastructure/s3/index.ts` | Make `date` required parameter |
| `apps/soa-finance/src/modules/document-generation/excel.generator.ts` | Extract `26` as `ALPHABET_LENGTH` constant |
| `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` | Extract `180_000` timeout constant |
| `apps/soa-finance/src/pipeline/scheduler.ts` | Extract `300_000` timeout constant |
| `apps/soa-finance/src/modules/payment/reconcile-payment.ts` | Extract `5` threshold constant |
| `apps/soa-finance/src/infrastructure/email/sender.ts` | Extract `30_000` timeout constant |
| `apps/finance/src/modules/trial-balance-sync/sync.service.test.ts` | Update test calls to pass required `currentTimeMillis` |

### Decomposition (Phase 3)
| File | Change |
|------|--------|
| `apps/finance/src/modules/closing/workflows/daily-closing.workflow.ts` | Split into focused modules (step executors, state mgmt, workflow def) |
| `apps/finance/src/modules/trial-balance-sync/sync.service.ts` | Extract `processCoaHierarchy` into own module, refactor to fix biome suppression |
| `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` | Extract email/state helpers into separate files |

### Dead Code & Deps (Phase 4)
| File | Change |
|------|--------|
| `apps/soa-finance/package.json` | Remove `@microsoft/microsoft-graph-client` |
| `apps/finance/package.json` | Remove `@restatedev/restate-sdk-zod` |
| `packages/shared/src/types/common.ts` | Remove unused `ServiceResult`, `WorkflowResult` |
| `packages/shared/src/utils/date.ts` | Remove unused `validateDateFormat` |
| `apps/soa-finance/src/modules/soa/objects/state.ts` | Remove unused type aliases |
| `apps/finance/src/modules/closing/services/genius-closing.service.ts` | Remove unused `_YEAR_REGEX`, `_MONTH_REGEX`, `_USER_ID_REGEX` |

### Architecture Cleanup (Phase 5)
| File | Change |
|------|--------|
| `packages/postgres/src/singleton.ts` | Add shared DB singleton factory that **accepts** app-specific options |
| `apps/finance/src/infrastructure/database.ts` | Use shared singleton from postgres package (preserving SSL, timeout, keepalive) |
| `apps/soa-finance/src/infrastructure/database/postgres.ts` | Use shared singleton from postgres package |
| `apps/finance/src/infrastructure/validation.ts` | Remove pass-through barrel |
| `apps/finance/src/modules/trial-balance-sync/sync-and-calculate.service.ts` | Inline into workflow or remove |
| Multiple barrel files (target: sub-directory barrels only) | Remove or flatten re-exports |
| `apps/soa-finance/src/pipeline/read/staging.ts` | Extract SQL to `.sql` file (update Lambda bundler too) |

### Test Infrastructure (Phase 6)
| File | Change |
|------|--------|
| `fetch-soa-data.test.ts`, `excel.generator.test.ts` | Replace `JSON.stringify` assertions |
| `apps/finance/src/modules/closing/workflows/__tests__/workflow-state.test.ts` | Add pure-reducer state transition tests (no Restate context needed) |
| `apps/soa-finance/src/pipeline/__tests__/scheduler.test.ts` | Add `getScheduleConfig` coverage for all 4 schedule types |

### Polish (Phase 7)
| File | Change |
|------|--------|
| 10 files with untyped catch | Add `: unknown` to catch clauses |
| 4+ files with mixed import styles | Normalize to `.js` extension consistently |
| `customer-query.ts` | Add `ORDER BY` to DISTINCT query |
| `apps/soa-finance/src/modules/reminder/process-reminder.ts` | Analyze parallelization feasibility (no `ctx.run()` wrapping) |
| `sync.service.ts` | Batch COA query into single round-trip |

---

## Phase 1: Critical Fixes (HIGH priority, behavioral)

### Task 1: Fix email durability + ordering in process-branches.ts

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts`

**Design (Oracle-Reviewed):** Keep generate + S3 upload + email send in a **single** `ctx.run()` block. Do NOT split — the `IFileData` buffers returned by `generateAndUploadDocuments` are too large to journal across separate `ctx.run()` calls. The key change is:
1. Move `sendWithAttachments()` **inside** the existing `ctx.run()` block (it's currently outside)
2. Move `createReminder()` to happen **after** the email is sent (currently before — creates reminder state for unsent emails)
3. Ensure email failures propagate properly (currently swallowed)

- [ ] **Step 1: Read current `processBranchSoa` function**

Run: `head -200 apps/soa-finance/src/modules/soa/services/process-branches.ts`

- [ ] **Step 2: Merge sendWithAttachments into the existing ctx.run block**

Current flow (lines ~73-106):
```
files = await ctx.run("generate-upload-send-{code}", ...)  // gen + upload only
sendWithAttachments(...)  // OUTSIDE ctx.run — replays resend email
createReminder(...)       // BEFORE email — reminder created even if send fails
```

Change to:
```
files = await ctx.run("generate-upload-send-{code}", ..., async () => {
  const files = await generateAndUploadDocuments({ ... });
  await sendWithAttachments({ ... });  // NOW inside ctx.run
  return files;
});
// createReminder ONLY after successful send — moved here
await createReminder({ ... });
```

- [ ] **Step 3: Remove the try/catch that swallows email errors (around line 102-106)**

The current catch logs the error and returns `{ hasDocuments: true }`. Change to let the error propagate — the caller (`processBranchSoa` caller) should handle it:

```typescript
} catch (error: unknown) {
  ctx.console.error(`Email send failed for ${customerData.code}:`, error);
  throw error; // Propagate — batchWorkflow handles via .map(value, failure)
}
```

**Note:** The email failure propagates up to `batchWorkflow.ts` which uses `.map(value, failure)` — this converts the failure into a result object without killing the batch. So individual email failures won't crash the entire batch.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 2: Fix email durability + letter state in generate-reminder-letter.ts

**Files:**
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

**Design (Oracle-Reviewed):** Same approach as Task 1 — keep gen+upload+send in ONE `ctx.run()`. The main difference here is the letter state machine: a failed email must leave the letter in `"failed"` state so it can be retried on the next workflow run, but NOT on the current retry (since ctx.run retries are internal and would just re-fail).

Key changes:
1. Merge `sendWithAttachments()` inside the existing `ctx.run()` block
2. After ctx.run succeeds: transition letter to `"SENT"` 
3. If ctx.run exhausts all retries: transition letter to `"failed"` in the outer catch

- [ ] **Step 1: Read current `generateUploadAndSendReminder` function**

Run: `head -270 apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

- [ ] **Step 2: Merge sendWithAttachments into existing ctx.run**

Current flow:
```
assignLetterRecord()  → sets letter to "pending"
ctx.run("generate-upload-send-reminder", ..., async () => {
  generateAndUploadDocuments(...)   // gen + upload inside
})
sendWithAttachments(...)  // OUTSIDE ctx.run
// only "pending" set — never transitions to "SENT" or "failed" on completion
```

Change to:
```
assignLetterRecord()  → sets letter to "pending" (reserves number)
ctx.run("generate-upload-send-reminder", ..., async () => {
  const files = await generateAndUploadDocuments({ ... });
  await sendWithAttachments({ ... });  // NOW inside ctx.run
  return files;
});
// If we reach here, send succeeded → mark sent
await ctx.set(`header:${...}`, { ...existingHeader, sentDate: ..., status: "SENT" });
```

- [ ] **Step 3: Fix leaked letter state on failure**

The current code never transitions from `"pending"` on failure. Add an outer try/catch:

```typescript
try {
  const files = await ctx.run("generate-upload-send-reminder", ...);
  await ctx.set(`header:${reminder.officeId}:${reminder.period}`,
    { ...existingHeader, sentDate: dateNow.toISOString(), status: "SENT" }
  );
} catch (error: unknown) {
  // ctx.run retries exhausted — mark letter as failed for next workflow run
  await ctx.set(`header:${reminder.officeId}:${reminder.period}`,
    { ...existingHeader, status: "failed" }
  );
  throw error;
}
```

**Important:** The `catch` block only runs after all `ctx.run` retries are exhausted. During retries, the letter stays `"pending"` — which is correct because `assignLetterRecord()` only reuses `"pending"` records, preventing duplicate letter numbers. After failure, `"failed"` state means the next workflow run can inspect and retry.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 3: Fix empty catch block — genius-closing.service.ts

**Files:**
- Modify: `apps/finance/src/modules/closing/services/genius-closing.service.ts`

**Context:** The empty `catch {}` at line 96-98 swallows errors from the `finally` block's `RESET` commands. If those RESET commands fail (because the connection was already broken), the error is silenced but the connection may be left in an inconsistent state.

- [ ] **Step 1: Read current `submitGeniusClosingJob` function**

Run: `head -120 apps/finance/src/modules/closing/services/genius-closing.service.ts`

- [ ] **Step 2: Replace empty catch with logged warning**

Change:
```typescript
} catch {
  // Connection reset after procedure failure — that's expected
}
```

To:
```typescript
} catch (error: unknown) {
  // Connection was likely killed by the procedure, log but don't re-throw
  console.warn("Session reset failed after Genius procedure (expected if connection was terminated):", error instanceof Error ? error.message : String(error));
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 4: Fix broken date test

**Files:**
- Modify: `apps/finance/src/modules/closing/workflows/daily-closing.workflow.test.ts`

**Context:** Test at line 24-27 expects `success: true` for date `"15-01-2025"` but `DateStringSchema` regex `/^\d{4}-\d{2}-\d{2}$/` rejects this input. Either the test is wrong (most likely) or the schema was tightened without updating the test.

- [ ] **Step 1: Read the current test file**

Run: `cat apps/finance/src/modules/closing/workflows/daily-closing.workflow.test.ts`

- [ ] **Step 2: Fix the test case**

If the schema enforces `YYYY-MM-DD`, the test should either:
- Use a valid date like `"2025-01-15"` and expect `success: true`, OR
- Update the test name and expectation to correctly reflect the schema behavior

Most likely fix — rename test and use valid input:

```typescript
it("validates date format (YYYY-MM-DD)", () => {
  const result = DailyClosingInput.safeParse({
    date: "2025-01-15",
    skipGeniusClosing: false,
    skipFinancialMetrics: false,
    userId: "user-001",
  });
  expect(result.success).toBe(true);
});
```

If you want to also test that invalid formats fail, add a second test:

```typescript
it("rejects invalid date formats", () => {
  const result = DailyClosingInput.safeParse({ ...validInput, date: "15-01-2025" });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 3: Run the test**

Run: `cd apps/finance && bun test`
Expected: All tests pass.

---

## Phase 2: Reliability (HIGH priority)

### Task 5: Fix non-deterministic timestamps

**Files:**
- Modify: `apps/finance/src/modules/financial-metrics/services/metrics.service.ts` (lines 75, 55)
- Modify: `apps/finance/src/modules/trial-balance-sync/sync.service.ts` (lines 61, 215, 228)
- Modify: `apps/finance/src/modules/trial-balance-sync/sync.service.test.ts` (test caller)
- Modify: `apps/soa-finance/src/infrastructure/s3/index.ts` (line 18)
- Modify: `apps/soa-finance/src/infrastructure/s3/s3-client.ts` (generateS3Key callers)

**Context:** Five locations use `DateTime.now()` or `new Date()` as fallback inside `ctx.run()` callbacks — these produce different values on replay, causing journal divergence.

- [ ] **Step 1: Fix `metrics.service.ts` — all non-deterministic timestamps**

File: `apps/finance/src/modules/financial-metrics/services/metrics.service.ts`

Two locations to fix:
1. Line 75: `DateTime.now().toMillis()` inside `calculateFinancialMetrics` — called from within `ctx.run()` in the workflow
2. Line 55: `DateTime.now().toMillis()` in `getCalculationRunStatus` — same ctx.run context

Make `currentTimeMillis` a **required** parameter for both `calculateFinancialMetrics` and `getCalculationRunStatus`. Remove all `DateTime.now()` fallbacks.

```typescript
export async function calculateFinancialMetrics(
  conn: PoolClient,
  closingDate: string,
  currentTimeMillis: number,  // was optional with DateTime.now() fallback
): Promise<FinancialMetricsResult> {
```

- [ ] **Step 2: Fix `sync.service.ts` — all 3 `new Date()` fallbacks**

File: `apps/finance/src/modules/trial-balance-sync/sync.service.ts`

Three locations:
- Line 61: `const currentDate = currentTimeMillis ? new Date(currentTimeMillis) : new Date();`
- Line 215: `endTime: new Date().toISOString()` — inside a result object
- Line 228: `endTime: new Date().toISOString()` — inside a result object (error path)

Make `currentTimeMillis` required (remove the fallback branch). Replace lines 215/228 with the passed-in timestamp:

```typescript
export async function syncTrialBalanceFromGenius(
  conn: PoolClient,
  closingDate: string,
  currentTimeMillis: number,  // REQUIRED
): Promise<SyncResult> {
```

For the `endTime` fields:
```typescript
endTime: new Date(currentTimeMillis).toISOString(),
```

- [ ] **Step 3: Update `sync.service.test.ts`**

File: `apps/finance/src/modules/trial-balance-sync/sync.service.test.ts`

The test currently calls `syncTrialBalanceFromGenius` without a `currentTimeMillis` argument. Update the call to pass `Date.now()`:

```typescript
const result = await syncTrialBalanceFromGenius(mockConn, "2025-01", Date.now());
```

- [ ] **Step 4: Fix `s3/index.ts` — remove `new Date()` fallback**

File: `apps/soa-finance/src/infrastructure/s3/index.ts`

At line 18, `date ?? new Date()` — make `date` required:

```typescript
export function generateS3Key(prefix: string, fileName: string, date: Date): string {
```

- [ ] **Step 5: Update callers of `generateS3Key`**

Grep for `generateS3Key(` calls and ensure they pass a deterministic `Date`. In `generate-and-upload.ts`, the callers pass `params.processingDate` which is a deterministic string from the workflow params — parse it explicitly:

```typescript
const s3Date = new Date(params.processingDate);
const key = generateS3Key(prefix, fileName, s3Date);
```

- [ ] **Step 6: Run typecheck for both apps**

Run: `cd apps/finance && bun run typecheck && cd apps/soa-finance && bun run typecheck`
Expected: Clean compilation.

### ~Task 6: Replace `Promise.all` with `RestatePromise.all`~ (DELETED — Oracle found this incorrect)

**Verdict:** Native `Promise.all()` inside a `ctx.run()` callback is **safe** and correct. `RestatePromise.all` is only needed for Restate/context promises *outside* `ctx.run()`. The `Promise.all` calls in `generate-and-upload.ts:52,76` run inside a `ctx.run()` callback — the individual promises call pure functions (Excel generation, S3 upload), not Restate context methods. No change needed.

### Task 7: Extract magic numbers into named constants

**Files:**
- Modify: `apps/soa-finance/src/modules/document-generation/excel.generator.ts` (26)
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` (180_000)
- Modify: `apps/soa-finance/src/pipeline/scheduler.ts` (300_000)
- Modify: `apps/soa-finance/src/modules/payment/reconcile-payment.ts` (5)
- Modify: `apps/soa-finance/src/infrastructure/email/sender.ts` (30_000)
- Create: `apps/soa-finance/src/constants/timeouts.ts`

- [ ] **Step 1: Create shared timeout constants file**

Create `apps/soa-finance/src/constants/timeouts.ts`:

```typescript
// Infrastructure operation timeout values (in milliseconds)
export const EMAIL_SEND_TIMEOUT_MS = 30_000;
export const DOCUMENT_GENERATION_TIMEOUT_MS = 180_000;
export const PIPELINE_TIMEOUT_MS = 300_000;
export const STAGING_READ_TIMEOUT_MS = 30_000;
```

- [ ] **Step 2: Import and use in `sender.ts`**

In `apps/soa-finance/src/infrastructure/email/sender.ts`, import `EMAIL_SEND_TIMEOUT_MS` and use in place of `30_000`.

- [ ] **Step 3: Import and use in `generate-reminder-letter.ts`**

Replace `180_000` with `DOCUMENT_GENERATION_TIMEOUT_MS`.

- [ ] **Step 4: Import and use in `scheduler.ts`**

Replace `300_000` with `PIPELINE_TIMEOUT_MS`.

- [ ] **Step 5: Extract threshold in `reconcile-payment.ts`**

Add to the file or existing constants:
```typescript
const BULK_PAYMENT_SAFETY_THRESHOLD = 5;
```
Replace the magic `5` at line 36.

- [ ] **Step 6: Extract `26` in `excel.generator.ts`**

At the top of `excel.generator.ts` or in the function scope:
```typescript
const ALPHABET_LENGTH = 26;
```
Replace `Math.floor(n / 26) - 1` with `Math.floor(n / ALPHABET_LENGTH) - 1` and `n % 26`.

- [ ] **Step 7: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

---

## Phase 3: Code Decomposition (MEDIUM priority)

### Task 8: Split `daily-closing.workflow.ts` (498 lines)

**Files:**
- Create: `apps/finance/src/modules/closing/workflows/step-executors.ts`
- Create: `apps/finance/src/modules/closing/workflows/workflow-state.ts`
- Create: `apps/finance/src/modules/closing/workflows/workflow-types.ts`
- Modify: `apps/finance/src/modules/closing/workflows/daily-closing.workflow.ts`

**Context:** The workflow file combines state management, input/output types, step execution (3 steps), orchestration (3 processStep functions), state machine logic, the workflow definition, and the status handler. This violates single responsibility.

- [ ] **Step 1: Extract types into `workflow-types.ts`**

Move `DailyClosingInput`, `DailyClosingResult`, `WorkflowState`, `WorkflowStatus` Zod schemas/types to a dedicated file. Import from new file.

- [ ] **Step 2: Extract state management into `workflow-state.ts`**

Move `updateWorkflowState`, `getStatus`, and any state read/write helpers. These take `WorkflowContext` and manage the `"state"` key.

- [ ] **Step 3: Extract step executors into `step-executors.ts`**

Move `executeGeniusStep`, `executeSyncTrialBalanceStep`, `executeMetricsStep` to a dedicated file. Each executor takes `(ctx, conn, input)` and returns step-specific results.

- [ ] **Step 4: Simplify workflow file to orchestration only**

The main `daily-closing.workflow.ts` should only contain `processGeniusStep`, `processSyncTrialBalanceStep`, `processFinancialMetricsStep` (orchestration wrappers) and the `run` handler.

- [ ] **Step 5: Run typecheck**

Run: `cd apps/finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 9: Refactor `sync.service.ts` (464 lines)

**Files:**
- Create: `apps/finance/src/modules/trial-balance-sync/coa-hierarchy.ts`
- Modify: `apps/finance/src/modules/trial-balance-sync/sync.service.ts`

**Context:** The `processCoaHierarchy` function (128 lines at lines 249-376) has a `// biome-ignore` suppression. It combines COA structure query + branch query + hierarchy building. Extract into its own module and reduce 3 round-trips to 1.

- [ ] **Step 1: Create `coa-hierarchy.ts`**

Extract `processCoaHierarchy` function into its own file with a cleaner interface. Combine the 3 separate DB queries into a single query:

```typescript
// Instead of: fetch COA → fetch branches → process
// Do: one query that returns COA with branch info
export async function processCoaHierarchy(
  conn: PoolClient,
  branchCodes?: string[],
): Promise<void> {
  // Single query: SELECT coa.*, b.branch_code FROM ... JOIN branches b ...
}
```

- [ ] **Step 2: Remove `biome-ignore` comment**

Remove the suppression once the function is refactored and cognitive complexity is reduced.

- [ ] **Step 3: Update import in `sync.service.ts`**

Change from inline function to imported function.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 10: Extract helpers from `generate-reminder-letter.ts` (401 lines)

**Files:**
- Create: `apps/soa-finance/src/modules/reminder/letter-state.ts`
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

**Context:** The file handles reminder data validation, letter state management, document generation orchestration, and email sending. Extract the letter state helpers.

- [ ] **Step 1: Extract `assignLetterRecord` and related state functions**

Move to `letter-state.ts`:
- `assignLetterRecord`
- `getLatestLetterRecord`
- Any letter state management helpers

- [ ] **Step 2: Update imports in `generate-reminder-letter.ts`**

- [ ] **Step 3: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

---

## Phase 4: Dead Code & Dependencies (MEDIUM priority)

### Task 11: Remove unused dependencies

**Files:**
- Modify: `apps/soa-finance/package.json`
- Modify: `apps/finance/package.json`

- [ ] **Step 1: Verify `@microsoft/microsoft-graph-client` is unused**

Run: `grep -r "microsoft-graph-client" apps/soa-finance/src/`
Expected: No matches (confirmed in analysis).

- [ ] **Step 2: Remove `@microsoft/microsoft-graph-client` from soa-finance package.json**

Remove from `dependencies` in `apps/soa-finance/package.json`.

- [ ] **Step 3: Verify `@restatedev/restate-sdk-zod` is unused**

Run: `grep -r "restate-sdk-zod" apps/finance/src/`
Expected: No matches (confirmed in analysis).

- [ ] **Step 4: Remove `@restatedev/restate-sdk-zod` from finance package.json**

- [ ] **Step 5: Reinstall dependencies**

Run: `bun install` from root.

### Task 12: Remove dead code in shared and soa-finance

**Files:**
- Modify: `packages/shared/src/types/common.ts`
- Modify: `packages/shared/src/utils/date.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/soa-finance/src/modules/soa/objects/state.ts`
- Modify: `apps/finance/src/modules/closing/services/genius-closing.service.ts`

- [ ] **Step 1: Remove unused `ServiceResult` and `WorkflowResult`**

In `packages/shared/src/types/common.ts`, remove the `ServiceResult<T>` and `WorkflowResult<T>` types. Update `packages/shared/src/types/index.ts` to not re-export them. Update `packages/shared/src/index.ts` to not export from types if types file becomes empty.

- [ ] **Step 2: Remove unused `validateDateFormat`**

In `packages/shared/src/utils/date.ts`, remove `validateDateFormat`. Update `packages/shared/src/utils/index.ts` and `packages/shared/src/index.ts`.

- [ ] **Step 3: Remove unused type aliases in `state.ts`**

Remove `CustomerContext`, `CustomerSharedContext`, `CreateReminderInput`, `AddLetterInput`, `MarkDcNotesPaidInput` from `apps/soa-finance/src/modules/soa/objects/state.ts`.

- [ ] **Step 4: Remove unused `_YEAR_REGEX`, `_MONTH_REGEX`, `_USER_ID_REGEX`**

From `apps/finance/src/modules/closing/services/genius-closing.service.ts`.

- [ ] **Step 5: Run typecheck for both apps + shared**

Run: `bun run typecheck`
Expected: Clean compilation.

---

## Phase 5: Architecture Cleanup (MEDIUM priority)

### Task 13: Consolidate DB singleton wrappers (config-preserving)

**Files:**
- Create: `packages/postgres/src/singleton.ts`
- Modify: `packages/postgres/src/index.ts`
- Modify: `apps/finance/src/infrastructure/database.ts`
- Modify: `apps/soa-finance/src/infrastructure/database/postgres.ts`

**Context (Oracle-Reviewed):** Both apps have ~45 lines of near-identical singleton wrappers. However, finance creates its pool with app-specific options: `ssl`, `query_timeout: SIX_HOURS_MS`, and `keepalive` settings. The shared singleton MUST preserve these via a config-accepting factory.

- [ ] **Step 1: Create `packages/postgres/src/singleton.ts` — config-preserving factory**

The singleton accepts optional overrides so each app can pass its specific requirements:

```typescript
import { createPostgresClient } from "./client.js";
import type { PostgresClient, PostgresConfig } from "./types.js";

type SingletonOptions = {
  /** Custom connection string (defaults to DATABASE_URL or POSTGRES_URL env) */
  connectionString?: string;
  /** Pool config overrides (e.g., ssl, query_timeout) */
  poolOverrides?: Partial<PostgresConfig>;
};

let globalClient: PostgresClient | null = null;

export function getGlobalPostgresClient(options?: SingletonOptions): PostgresClient {
  if (!globalClient) {
    const url = options?.connectionString
      ?? process.env.DATABASE_URL
      ?? process.env.POSTGRES_URL;
    if (!url) {
      throw new Error("DATABASE_URL or POSTGRES_URL must be set");
    }
    globalClient = createPostgresClient({
      connectionString: url,
      ...options?.poolOverrides,
    });
  }
  return globalClient;
}

export async function closeGlobalPostgresClient(): Promise<void> {
  if (globalClient) {
    await globalClient.close();
    globalClient = null;
  }
}

export function resetGlobalPostgresClient(): void {
  globalClient = null;
}
```

**Why this matters:** Finance currently creates its pool with:
```typescript
createPostgresClient({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  query_timeout: SIX_HOURS_MS,  // 21_600_000ms for long Genius procedure
  keepalive: true,
});
```

The overrides pattern allows this to be preserved when adopting the singleton.

- [ ] **Step 2: Export from `packages/postgres/src/index.ts`**

Add: `export { getGlobalPostgresClient, closeGlobalPostgresClient, resetGlobalPostgresClient } from "./singleton.js";`

- [ ] **Step 3: Update finance `infrastructure/database.ts`**

Replace custom singleton: call `getGlobalPostgresClient({ poolOverrides: { ssl: ..., query_timeout: ..., keepalive: ... } })`.

- [ ] **Step 4: Update soa-finance `infrastructure/database/postgres.ts`**

Same pattern — soa-finance uses fewer overrides so can just call `getGlobalPostgresClient()`.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: Clean compilation.

### Task 14: Remove pass-through wrappers

**Files:**
- Delete or modify: `apps/finance/src/infrastructure/validation.ts`
- Delete or modify: `apps/finance/src/modules/trial-balance-sync/sync-and-calculate.service.ts`

- [ ] **Step 1: Remove `infrastructure/validation.ts`**

Update callers to import directly from `@restate-tob/shared`.

- [ ] **Step 2: Inline or remove `sync-and-calculate.service.ts`**

Check if any file besides the importing source still imports it. If only one caller, inline. If zero callers, remove.

- [ ] **Step 3: Run typecheck**

Run: `cd apps/finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 15: Extract SQL to `.sql` files (with Lambda bundling fix)

**Files:**
- Create: `apps/soa-finance/src/pipeline/read/staging.sql`
- Modify: `apps/soa-finance/src/pipeline/read/staging.ts`
- Modify: `apps/soa-finance/package.json` (postbundle:lambda)

**Context:** The 119-line SQL query embedded in `staging.ts:8-126` is hard to read, edit, or review. Extract to a `.sql` file and read at runtime.

**⚠️ Lambda bundling:** The current `postbundle:lambda` in `package.json`:
```
"postbundle:lambda": "bunx tsm scripts/build/lambda/lambda-assets.mts"
```
This copies assets (fonts, images) but does NOT copy `.sql` files. You must update the assets script (or add a step) to include `.sql` files from `src/pipeline/read/` to `dist-lambda/pipeline/read/`.

- [ ] **Step 1: Read the Lambda assets script**

Run: `cat apps/soa-finance/scripts/build/lambda/lambda-assets.mts`

- [ ] **Step 2: Update the assets script to copy `.sql` files**

Add a line like:
```typescript
// Copy SQL files used at runtime
fs.cpSync("src/pipeline/read/staging.sql", "dist-lambda/pipeline/read/staging.sql", { recursive: true });
```

- [ ] **Step 3: Create `staging.sql` with the raw SQL**

Copy the SQL from `staging.ts:8-126` verbatim into `staging.sql`.

- [ ] **Step 4: Create a helper to load the SQL in `staging.ts`**

```typescript
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STAGING_SQL = readFileSync(
  join(__dirname, "staging.sql"),
  "utf-8"
);
```

- [ ] **Step 5: Update `staging.ts` to use the loaded SQL**

Replace the inline template literal with `STAGING_SQL` variable.

- [ ] **Step 6: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 16: Remove barrel files (full import scan)

**Files:** Sub-directory barrel `index.ts` files across both apps.

**Approach:** Module-level barrels are OK; sub-directory barrels are not. Target sub-directory barrels only.

**⚠️ Required: full import scan, not just `/index` grep.** Directory imports like `from "./templates"` resolve to `./templates/index.ts` but won't match a `grep` for `"from.*/index"`. You must also grep for the directory name pattern.

- [ ] **Step 1: Identify barrel files and their directory-name importers**

For each barrel candidate (e.g., `apps/soa-finance/src/modules/email/templates/index.ts`), grep for BOTH patterns:

Run: `grep -rn "from\s*['\"].*/templates['\"]" apps/soa-finance/src/` (directory import)
Run: `grep -rn "from\s*['\"].*/templates/index['\"]" apps/soa-finance/src/` (explicit index import)

- [ ] **Step 2: For each barrel file found, check**

If any import references it (via directory name), update those imports to point to the specific file instead:

Change `from "./templates"` → `from "./templates/index"` (explicit, then the barrel can be deleted)

OR, if the barrel adds real value (combining 2+ exports), keep it. But ideally flatten the re-export.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Clean compilation.

---

## Phase 6: Test Infrastructure (MEDIUM priority)

### Task 17: Fix `JSON.stringify` test assertions

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/fetch-soa-data.test.ts`
- Modify: `apps/soa-finance/src/modules/document-generation/excel.generator.test.ts`

- [ ] **Step 1: Find all `JSON.stringify` assertions**

Grep: `grep -n "JSON.stringify" apps/soa-finance/src/**/*.test.ts`

- [ ] **Step 2: Replace with `toStrictEqual` or `toEqual`**

Change from:
```typescript
expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
```

To:
```typescript
expect(result).toStrictEqual(expected);
```

Bun's `toStrictEqual` provides useful diff output on failure and handles undefined/absent key distinctions properly.

- [ ] **Step 3: Run tests**

Run: `cd apps/soa-finance && bun test`
Expected: All tests pass.

### Task 18: Add workflow state transition tests (pure reducer pattern)

**Files:**
- Modify: `apps/finance/src/modules/closing/workflows/daily-closing.workflow.ts`
- Create: `apps/finance/src/modules/closing/workflows/__tests__/workflow-state.test.ts`

**Context:** The workflow has explicit state transitions. Testing them requires a **pure state reducer** — extract state logic from `WorkflowContext` into a testable pure function, then test transitions independently of Restate.

- [ ] **Step 1: Extract a pure state transition function**

In `daily-closing.workflow.ts` (or in `workflow-state.ts` if decomposed in Task 8), create:

```typescript
export type WorkflowStep = 
  | "idle" 
  | "genius-closing" 
  | "sync-trial-balance" 
  | "financial-metrics" 
  | "completed" 
  | "failed";

export interface WorkflowState {
  currentStep: WorkflowStep;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// Pure function — no Restate context needed
export function transitionState(
  state: WorkflowState,
  nextStep: WorkflowStep,
  error?: string,
): WorkflowState {
  const now = new Date().toISOString();
  switch (nextStep) {
    case "idle":
      return { currentStep: "idle", startedAt: now };
    case "genius-closing":
    case "sync-trial-balance":
    case "financial-metrics":
      return { ...state, currentStep: nextStep };
    case "completed":
      return { ...state, currentStep: "completed", completedAt: now };
    case "failed":
      return { ...state, currentStep: "failed", completedAt: now, error };
    default:
      return state;
  }
}
```

**Note:** The `now` value is only for test assertion convenience. In the actual workflow, the timestamp would come from `ctx.date.now()`.

- [ ] **Step 2: Write tests in `workflow-state.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { transitionState } from "../daily-closing.workflow";
import type { WorkflowState } from "../daily-closing.workflow";

describe("WorkflowState transitions", () => {
  const idleState: WorkflowState = { currentStep: "idle", startedAt: "2025-01-01T00:00:00.000Z" };

  it("starts in idle state", () => {
    const result = transitionState(
      { currentStep: "idle" },
      "genius-closing",
    );
    expect(result.currentStep).toBe("genius-closing");
  });

  it("transitions through all steps in order", () => {
    const steps: WorkflowStep[] = [
      "genius-closing",
      "sync-trial-balance",
      "financial-metrics",
      "completed",
    ];
    let state = idleState;
    for (const step of steps) {
      state = transitionState(state, step);
      expect(state.currentStep).toBe(step);
    }
  });

  it("transitions to failed on error", () => {
    const result = transitionState(idleState, "failed", "Something broke");
    expect(result.currentStep).toBe("failed");
    expect(result.error).toBe("Something broke");
    expect(result.completedAt).toBeDefined();
  });

  it("completed state has completedAt set", () => {
    const result = transitionState(
      { currentStep: "financial-metrics" },
      "completed",
    );
    expect(result.currentStep).toBe("completed");
    expect(result.completedAt).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/finance && bun test`
Expected: All tests pass.

### Task 19: Add scheduler schedule coverage

**Files:**
- Modify: `apps/soa-finance/src/pipeline/scheduler.test.ts`

**Context:** The scheduler test covers `computeNextRun` for all schedule types but NOT `getScheduleConfig` (note: check the actual exported function name — the scheduler module exports `computeNextRun`, `getScheduleConfig`, and related constants). Add test coverage for `getScheduleConfig` to verify each of the 4 schedule types returns the correct type and send days.

- [ ] **Step 1: Read the scheduler module exports**

Run: `head -60 apps/soa-finance/src/pipeline/scheduler.ts`

Identify the exported function name for schedule config lookup (it may be `getScheduleConfig` or `getScheduleConfigs` or similar).

- [ ] **Step 2: Add test coverage**

Append to `scheduler.test.ts`:

```typescript
import { getScheduleConfig, SCHEDULE_TYPES } from "../scheduler";

describe("getScheduleConfig", () => {
  it("returns SOA config for type 1", () => {
    const config = getScheduleConfig(1);
    expect(config.type).toBe(1);
    // verify sendDays are defined
    expect(config.sendDays).toBeDefined();
    expect(config.sendDays.length).toBeGreaterThan(0);
  });

  it("returns RL2 config for type 3", () => {
    const config = getScheduleConfig(3);
    expect(config.type).toBe(3);
  });

  it("returns WL config for type 4", () => {
    const config = getScheduleConfig(4);
    expect(config.type).toBe(4);
  });

  it("throws for invalid type", () => {
    expect(() => getScheduleConfig(99)).toThrow();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/soa-finance && bun test`
Expected: All tests pass.

---

## Phase 7: Polish (LOW priority)

### Task 20: Fix catch clause typing

**Files:** 10 files across both apps use untyped `catch (error)` instead of `catch (error: unknown)`.

- [ ] **Step 1: Identify all untyped catch clauses**

Grep: `grep -n "catch\s*(" apps/*/src/**/*.ts | grep -v ": unknown"`

- [ ] **Step 2: Add `: unknown` to each**

For each match, change `catch (error)` to `catch (error: unknown)`.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Clean compilation.

### Task 21: Normalize import style

**Files:** 4+ files mix `.js` extensions and bare imports.

- [ ] **Step 1: Identify inconsistent files**

Grep: Files that import with `.js` in some lines but not others.

- [ ] **Step 2: Normalize to project convention**

Check `tsconfig.json` module resolution. If `nodenext` or `node16`, `.js` extensions are required for ESM. Apply consistently.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Clean compilation.

### ~Task 22: Add scheduler double-init guard~ (DELETED — Oracle says unnecessary)

**Verdict:** Restate virtual objects already serialize handlers for the same key. Both schedulers set `"started"` before scheduling. There is no race condition between concurrent `start` invocations because Restate processes them sequentially for the same object instance. No change needed.

### Task 23: Analyze reminder parallelization feasibility

**Files:**
- Read-only: `apps/soa-finance/src/modules/reminder/process-reminder.ts`

**Context:** The `for` loop processes each reminder sequentially. Each reminder is independent (different branch/office), but parallelization is constrained by Restate rules.

**Constraint (Oracle-Reviewed):** `generateReminderLetter()` already uses `ctx.get`, `ctx.set`, `ctx.run`, and `ctx.objectClient` — these cannot be wrapped in another `ctx.run()`. The function IS the context-aware operation. Parallelization would require a different architectural approach.

- [ ] **Step 1: Read current `processReminderLetter` to understand the loop**

```typescript
// Current sequential pattern:
for (const reminder of reminders) {
  const result = await generateReminderLetter({ ctx, customer, reminder, item });
  // accumulate results
}
```

- [ ] **Step 2: Assess if parallelization is worthwhile**

The sequential loop is a safety concern for large batches (blocking on N sequential ctx.run retry cycles). However, `generateReminderLetter` is already inside a `soaCustomer` virtual object handler which Restate serializes per key. Parallelizing within a single handler is possible with `RestatePromise.all` at the **invocation level** (NOT wrapped in ctx.run):

```typescript
const results = await RestatePromise.all(
  reminders.map((reminder) =>
    generateReminderLetter({ ctx, customer, reminder, item })
      .then((result): IGenerateReminderResult | null => result)
      .catch((): IGenerateReminderResult | null => null)
  )
);
```

This works because `generateReminderLetter` calls `ctx.run()` internally — the individual `ctx.run()` calls are journaled independently. Restate handles the concurrency.

- [ ] **Step 3: Only implement if batch sizes justify it**

If the typical reminder batch is small (1-5 reminders), the sequential loop is fine. Only parallelize if you've observed slow sequential processing for large batches.

**Decision:** Skip for now unless bottlenecks are observed. Mark as `[future]`.

### Task 24: Batch COA queries into single round-trip

**Files:**
- Modify: `apps/finance/src/modules/trial-balance-sync/sync.service.ts`

**Context:** `processCoaHierarchy` makes 3 sequential DB reads: COA structure, branches, and main data. Batch into one query.

- [ ] **Step 1: Combine into single SQL query**

Instead of 3 separate `client.query()` calls, write a single query that LEFT JOINs COA with branches.

- [ ] **Step 2: Update the processing logic to work from a single result set**

- [ ] **Step 3: Run typecheck**

Run: `cd apps/finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 25: Add ORDER BY to DISTINCT query

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/queries/customer-query.ts`

- [ ] **Step 1: Add ORDER BY to ensure deterministic ordering**

```sql
SELECT DISTINCT ON (cd.EMAIL) cd.EMAIL
FROM ...
ORDER BY cd.EMAIL
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

---

## Verification Plan

- [ ] Run `bun run typecheck` — zero errors across all apps and packages
- [ ] Run `bun run check` — zero lint errors
- [ ] Run `cd apps/finance && bun test` — all tests pass
- [ ] Run `cd apps/soa-finance && bun test` — all tests pass
- [ ] LSP diagnostics clean on all modified files

## Self-Review (Post-Oracle)

- [ ] **Spec coverage:** All 38 identified issues map to tasks (critical: 1-4, reliability: 5+7, decomposition: 8-10, dead code: 11-12, arch: 13-16, tests: 17-19, polish: 20-21+24-25). Tasks 6 and 22 deleted per Oracle feedback. Task 23 deferred.
- [ ] **Placeholder scan:** No TBD, TODO, or incomplete code sections. Task 23 is explicitly marked `[future]`.
- [ ] **Type consistency:** All signatures verified. Task 5 adds required timestamp params — callers and tests updated.
- [ ] **Safety (Oracle-reviewed):**
  - Tasks 1-2: `sendWithAttachments` MOVED INTO existing `ctx.run()` (not split) — no new journal entries. `createReminder` moved AFTER send for correctness.
  - Task 6: DELETED — `Promise.all` inside `ctx.run()` is safe.
  - Task 13: Uses config-preserving factory pattern — apps retain SSL/timeout/keepalive options.
  - Task 15: Lambda bundling updated to copy `.sql` files.
  - Task 18: Uses pure reducer pattern — no Restate context mocking needed.
  - Task 22: DELETED — Restate serializes Virtual Object handlers.
  - Task 23: Deferred — wraps at `RestatePromise.all` level, not in `ctx.run()`.
- [ ] **Deployment safety:** Tasks 1-2 change journal shape. Must use immutable deployment (new version) or drain active invocations before deploying.

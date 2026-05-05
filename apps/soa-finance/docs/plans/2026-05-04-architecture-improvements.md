# SOA Finance Architecture Improvements Plan (v3 — Oracle-reviewed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent data loss in the ETL pipeline, add per-account error isolation, eliminate the Azure buffer round-trip in document→email flow (Restate-safe), flatten unnecessary SOA indirection, memoize static assets, and remove dead/misleading code.

**Architecture:** Incremental refactoring within existing files. No new architectural components. Pipeline gets per-row observability and per-account error isolation. Document generation combines generate→upload→send into a single `ctx.run()` to eliminate buffer round-trip without journal bloat. SOA workflow inlines the thin `newSoa` wrapper while preserving all `ctx.run()` boundaries. Static images are memoized.

**Tech Stack:** TypeScript, Restate SDK, Apache Arrow/Parquet (parquet-wasm), Oracle DB, Azure Blob Storage, Gotenberg, Microsoft Graph API, LiquidJS

**Dependencies:**
- Task 5 (flatten SOA) depends on Task 4 (buffer round-trip): Task 4 modifies `new-soa.ts`, then Task 5 inlines it into `soa-customer.ts`.
- Tasks 1, 2, 3 are independent of each other (all modify pipeline/transform and pipeline/write)
- Tasks 6, 7, 8 are independent of all preceding tasks
- Task 9 (verification) depends on all preceding tasks

---

### Task 1: Add dropped-row counters, logging, and error tracking in pipeline transform (P0)

**Files:**
- Modify: `src/pipeline/transform/soa-transformer.ts`
- Modify: `src/pipeline/transform/index.ts`

**Context:** `transformSoaRow()` silently drops rows when `row.length < 37` or `NETT_PREMIUM === 0`. No counter, no log, no visibility. `transformSoaStream()` also catches row-mapping errors and continues silently. These gaps make it impossible to audit data quality or detect schema drift. The actual column key is `NETT_PREMIUM` (index 31 in `pipeline/types.ts`), not `NET_PREMIUM`.

- [ ] **Step 1: Add TransformCounters type and factory in `soa-transformer.ts`**

Edit `src/pipeline/transform/soa-transformer.ts` — add this after the existing imports, before `transformSoaRow`:

```typescript
import { column } from "../types";

export type TransformCounters = {
  /** Total rows received from Oracle read stage */
  received: number;
  /** Rows successfully mapped and yielded */
  emitted: number;
  /** Rows dropped because row.length < 37 */
  droppedShortRow: number;
  /** Rows dropped because NETT_PREMIUM === 0 */
  droppedZeroPremium: number;
  /** Rows that threw during transformSoaRow mapping */
  errored: number;
};

export function createTransformCounters(): TransformCounters {
  return {
    received: 0,
    emitted: 0,
    droppedShortRow: 0,
    droppedZeroPremium: 0,
    errored: 0,
  };
}
```

- [ ] **Step 2: Thread counters through `transformSoaRow`**

In the same file — modify `transformSoaRow` to accept and increment counters. Update the two early-return paths:

```typescript
// Add `counters` parameter to the function signature:
export function transformSoaRow(
  row: unknown[],
  counters: TransformCounters
): IStatementOfAccountModel | null {
  counters.received++;

  // REPLACE existing line "if (row.length < 37) { return null; }" with:
  if (row.length < 37) {
    counters.droppedShortRow++;
    return null;
  }

  // REPLACE existing line "if (netPremium === 0) { return null; }" with:
  const netPremium = parseNumber(row[column.NETT_PREMIUM]);
  if (netPremium === 0) {
    counters.droppedZeroPremium++;
    return null;
  }

  // ... rest of mapping unchanged ...

  // At end, before return statement:
  counters.emitted++;
  return { ... } as IStatementOfAccountModel;
}
```

- [ ] **Step 3: Thread counters through `transformSoaStream` and log summary**

Edit `src/pipeline/transform/index.ts` — modify `transformSoaStream` to create counters, pass to `transformSoaRow`, and log at completion:

```typescript
import { createTransformCounters, transformSoaRow } from "./soa-transformer";
import type { TransformCounters } from "./soa-transformer";

export async function* transformSoaStream(
  source: AsyncIterable<unknown[]>
): AsyncGenerator<IStatementOfAccountModel> {
  const counters = createTransformCounters();
  for await (const row of source) {
    try {
      const transformed = transformSoaRow(row, counters);
      if (transformed !== null) {
        yield transformed;
      }
    } catch (error) {
      counters.errored++;
      console.error(
        `[Pipeline Transform] Row mapping failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  console.log(
    `[Pipeline Transform] Complete. Received: ${counters.received}, ` +
    `Emitted: ${counters.emitted}, Dropped (short row): ${counters.droppedShortRow}, ` +
    `Dropped (zero premium): ${counters.droppedZeroPremium}, ` +
    `Errored: ${counters.errored}`
  );
}
```

- [ ] **Step 4: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. The `counters` parameter is added to `transformSoaRow`. No existing callers break because `transformSoaStream` is the only caller.

---

### Task 2: Add runtime column count validation in pipeline transform (P0)

**Files:**
- Modify: `src/pipeline/transform/soa-transformer.ts`

**Context:** `transformSoaRow()` accesses positional array indices via the `column` map from `pipeline/types.ts` (e.g., `row[column.NETT_PREMIUM]`). If the Oracle SQL SELECT count changes (columns added/removed), rows silently map wrong data. Add a runtime check that validates the row column count matches the expected number of columns defined in the `column` object.

**Limitation:** This only validates row width, not column order. If the SQL is reordered to same-width columns, field corruption is still possible. That requires integration tests. This task catches the common case of column addition/removal.

- [ ] **Step 1: Add validation flag and function**

Edit `src/pipeline/transform/soa-transformer.ts` — add below the existing imports and before `transformSoaRow`:

```typescript
import { column } from "../types";

// The expected number of columns from Oracle. Must match Object.keys(column).length.
// If the SQL SELECT in pipeline/read/index.ts changes column count, this will
// fire a warning on the first row processed.
const EXPECTED_COLUMN_COUNT = Object.keys(column).length;
let schemaValidated = false;

function validateRowWidth(row: unknown[]): void {
  if (schemaValidated) {
    return;
  }
  schemaValidated = true;

  if (row.length !== EXPECTED_COLUMN_COUNT) {
    console.error(
      `[Pipeline Transform] SCHEMA MISMATCH: Row has ${row.length} columns, ` +
      `expected ${EXPECTED_COLUMN_COUNT}. The Oracle SQL SELECT column count ` +
      `may have changed. Expected keys: ${Object.keys(column).join(", ")}. ` +
      `Check pipeline/read/index.ts and pipeline/types.ts are in sync.`
    );
  }

  console.log(
    `[Pipeline Transform] Schema validated: ${row.length} columns (expected ${EXPECTED_COLUMN_COUNT}). ` +
    `First row sample: ${JSON.stringify(row.slice(0, 3))}`
  );
}
```

- [ ] **Step 2: Call `validateRowWidth` at start of `transformSoaRow`**

In the same file — add as the second line of `transformSoaRow` (after `counters.received++`):

```typescript
export function transformSoaRow(
  row: unknown[],
  counters: TransformCounters
): IStatementOfAccountModel | null {
  counters.received++;
  validateRowWidth(row);
  // ... existing code unchanged
```

- [ ] **Step 3: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. `validateRowWidth` fires once on the first row, logs expected vs actual column count.

---

### Task 3: Add per-account error isolation in pipeline write stage (P1)

**Files:**
- Modify: `src/pipeline/write/index.ts`

**Context:** Currently `writeToParquet` iterates over account groups and calls `uploadParquetToStorage`. If one account's upload fails, the `throw` kills the pipeline. On Restate retry, ALL accounts are re-queried from Oracle (the most expensive operation). Wrap each account's write+upload in try-catch so other accounts proceed independently. If ALL accounts fail, throw so Restate retries (empty pipeline would silently skip all customers).

**Note:** The in-memory `Map` materialization is kept. Full memory reduction requires `ORDER BY distribution_code` in the Oracle SQL (126 lines) to enable progressive write+clear — too risky for this plan. This task fixes the error isolation.

- [ ] **Step 1: Wrap per-account upload in try-catch with all-fail detection**

Read `src/pipeline/write/index.ts`. Replace the per-account loop body (the `for...of datasAccount` block, starting around line 35) with error-isolated version:

```typescript
  let uploaded = 0;
  let failed = 0;
  const failedAccounts: string[] = [];

  for (const [distributionCode, rows] of datasAccount) {
    try {
      const fileName = `soa_${distributionCode}.parquet`;
      const buffer = writeSoaParquetToBuffer(rows);

      const result = await uploadParquetToStorage(
        fileName,
        buffer,
        referenceDate
      );

      if (!result.success) {
        throw new Error(`Upload returned success=false for ${fileName}`);
      }

      uploaded++;
      console.log(
        `[Pipeline] Uploaded ${rows.length} rows for ${distributionCode} to ${result.key}`
      );
    } catch (error: unknown) {
      failed++;
      failedAccounts.push(distributionCode);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[Pipeline] Failed to upload for account ${distributionCode}: ${errorMessage}`
      );
    }
  }

  console.log(
    `[Pipeline Write] Complete. Uploaded: ${uploaded}, Failed: ${failed}`
  );

  if (failed > 0) {
    for (const account of failedAccounts) {
      console.error(`[Pipeline Write] Failed account: ${account}`);
    }
  }

  // If ALL accounts failed and there were accounts to process, throw
  // so Restate retries the pipeline. Partial success is acceptable.
  if (failed > 0 && uploaded === 0 && datasAccount.size > 0) {
    throw new Error(
      `Pipeline write failed: all ${datasAccount.size} accounts failed to upload`
    );
  }
```

Remove the existing per-account block that throws on `!result.success` (the original `throw new Error(...)` inside the for loop).

- [ ] **Step 2: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. The write loop uses try-catch and all-fail check.

---

### Task 4: Memoize static image assets (P2)

**Files:**
- Modify: `src/modules/document-generation/pdf-assets.ts`

**Context:** `getSignature()`, `getHeader()`, `getFooter()` each call `getAssetAsBase64()` which reads a file from disk and re-base64-encodes it. These are invoked 4-5 times per document from different callers: `pdf-template.ts` (in `buildPdfTemplateData`), `pdf-render.ts` (in `renderLiquidToHtml`), `attachments.ts` (in `buildEmailAttachments`), and `email/templates/reminder.ts` (in `generateReminderEmailHtml`). Since the images are static (never change per customer or per run), add simple null-check memoization.

- [ ] **Step 1: Add module-level memoization**

Edit `src/modules/document-generation/pdf-assets.ts` — replace each function:

```typescript
// BEFORE (re-reads from disk every call):
export function getSignature(): string {
  return getAssetAsBase64("sign.jpeg");
}
export function getHeader(): string {
  return getAssetAsBase64("header-letter.png");
}
export function getFooter(): string {
  return getAssetAsBase64("bottom-letter.png");
}

// AFTER (memoized per-process):
let cachedSignature: string | null = null;
let cachedHeader: string | null = null;
let cachedFooter: string | null = null;

export function getSignature(): string {
  if (!cachedSignature) {
    cachedSignature = getAssetAsBase64("sign.jpeg");
  }
  return cachedSignature;
}

export function getHeader(): string {
  if (!cachedHeader) {
    cachedHeader = getAssetAsBase64("header-letter.png");
  }
  return cachedHeader;
}

export function getFooter(): string {
  if (!cachedFooter) {
    cachedFooter = getAssetAsBase64("bottom-letter.png");
  }
  return cachedFooter;
}
```

This is safe because assets are static files in `src/assets/`, the process is short-lived (Lambda), and base64 encoding is deterministic. The non-null assertions on cached values are valid since `getAssetAsBase64` always returns a non-empty string.

- [ ] **Step 2: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. No behavior change.

---

### Task 5: Flatten SOA indirection — inline `newSoa` into `soaCustomer` (P2)

**Files:**
- Modify: `src/modules/soa/objects/soa-customer.ts`
- Delete: `src/modules/soa/services/new-soa.ts`
- Modify: `src/modules/soa/services/index.ts`
- Modify: `src/modules/soa/index.ts`

**Context:** The call chain is `soaCustomer.process() → newSoa() → processBranchSoa()`. `newSoa` does nothing but call `processBranchSoa` and then `sendWithAttachments` in `ctx.run()` if documents exist. This thin wrapper adds indirection with zero abstraction value.

**Critical:** The inline code MUST preserve the `ctx.run("send-email")` wrapper around `sendWithAttachments`. Losing this wrapper means external email I/O is not durable. The current `newSoa` correctly wraps it — the inline code must do the same.

- [ ] **Step 1: Inline `newSoa` logic into `soaCustomer.process` with `ctx.run` preserved**

Read `src/modules/soa/objects/soa-customer.ts`. Add these imports:

```typescript
import { processBranchSoa } from "../services/process-branches";
import { sendWithAttachments } from "../../email";
```

Replace the `newSoa(...)` call (line 59) with the inlined logic. The "else" block becomes:

```typescript
  } else {
    const dateNow = new Date(soaParams.processingDate);

    const hasDocuments = await processBranchSoa({
      ctx,
      customerData,
      params: soaParams,
    });

    if (hasDocuments) {
      await ctx.run("send-email", async () =>
        await sendWithAttachments({
          customerId: soaParams.customerId,
          customerData,
          date: dateNow,
        })
      );
    } else {
      ctx.console.log(
        `Skipping email for ${soaParams.customerId}: no documents generated`
      );
    }
  }
```

Note: This is the exact body of `newSoa.ts` lines 12-34, inlined verbatim. The `ctx.run("send-email")` wrapper is preserved.

- [ ] **Step 2: Remove `newSoa` import from `soa-customer.ts`**

Remove line:
```typescript
import { newSoa } from "../services";
```

- [ ] **Step 3: Delete `new-soa.ts`**

```bash
rm src/modules/soa/services/new-soa.ts
```

- [ ] **Step 4: Update barrels**

Edit `src/modules/soa/services/index.ts` — remove the `newSoa` export:

```typescript
// REMOVE this line:
export { newSoa } from "./new-soa";

// Keep this line:
export { processBranchSoa } from "./process-branches";
```

Edit `src/modules/soa/index.ts` — replace the wildcard services export with explicit exports:

```typescript
// BEFORE:
export { generateSoa } from "./generate";
export * from "./services";
export * from "./workflows";

// AFTER:
export { generateSoa } from "./generate";
export { processBranchSoa } from "./services";
export * from "./workflows";
```

- [ ] **Step 5: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. No imports of `newSoa` remain. Search for any residual references: `rg "newSoa" src/` should return zero results.

---

### Task 6: Rename `generate.ts` → `fetch-soa-data.ts` (P3)

**Files:**
- Rename: `src/modules/soa/generate.ts` → `src/modules/soa/fetch-soa-data.ts`
- Modify: `src/modules/soa/index.ts`
- Modify: `src/modules/soa/services/process-branches.ts`

**Context:** `generate.ts` doesn't generate documents — it fetches SOA data from Parquet and applies aging/dedup filters. The name misleads new developers who expect it to generate PDFs/Excel. Rename to reflect its actual purpose: fetching and filtering SOA data.

- [ ] **Step 1: Rename the file**

```bash
cd src/modules/soa && mv generate.ts fetch-soa-data.ts
```

- [ ] **Step 2: Update imports**

Edit `src/modules/soa/index.ts` — line that exports `generateSoa`:

```typescript
// BEFORE:
export { generateSoa } from "./generate";

// AFTER:
export { generateSoa } from "./fetch-soa-data";
```

Edit `src/modules/soa/services/process-branches.ts` — update the import of `generateSoa`:

```typescript
// BEFORE (line 12):
import { generateSoa } from "../generate";

// AFTER:
import { generateSoa } from "../fetch-soa-data";
```

- [ ] **Step 3: Verify — build + typecheck**

Run: `bun run --filter @restate-tob/soa-finance build`
Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: Both pass. No stale `from "../generate"` imports remain. Verify with: `rg "from ['\"].*generate['\"]" src/modules/` (only `document-generation` references should remain).

---

### Task 7: Remove dead export `collectPipelineData` (P3)

**Files:**
- Modify: `src/pipeline/index.ts`

**Context:** `collectPipelineData` is exported but never imported anywhere in the codebase. It runs the same read→transform chain as `generateSoaPipeline` but returns an in-memory Map instead of writing to Azure. Dead code increases maintenance burden and confuses new developers.

- [ ] **Step 1: Read `pipeline/index.ts` and locate `collectPipelineData`**

The function is approximately 20-25 lines. It starts with `export async function collectPipelineData(` and contains the same Oracle streaming + transform logic as `generateSoaPipeline` but collects into a Map.

- [ ] **Step 2: Delete the function and any imports it exclusively uses**

Delete the entire `collectPipelineData` function body and its export. If any imports (`streamSoaData`, `transformSoaStream`) are also used by `generateSoaPipeline`, keep them. If only used by `collectPipelineData`, remove them too.

Expected: `generateSoaPipeline` uses `streamSoaData` and `transformSoaStream`, so those imports are kept. The only change is removing the `collectPipelineData` function itself.

- [ ] **Step 3: Verify — build check**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: TypeScript compiles. No error about missing `collectPipelineData`. Verify: `rg "collectPipelineData" src/` returns zero results.

---

### Task 8: Verification — full build + typecheck + lint

**Files:** (none — verification only)

- [ ] **Step 1: Clean build**

Run: `bun run --filter @restate-tob/soa-finance build`
Expected: Exit code 0. No TypeScript errors.

- [ ] **Step 2: Typecheck**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: Exit code 0. No type errors.

- [ ] **Step 3: Lint**

Run: `bun run --filter @restate-tob/soa-finance lint`
Expected: No new lint errors introduced by these changes. Pre-existing lint issues are acceptable.

- [ ] **Step 4: Verify no stale imports**

Run: `rg "newSoa" src/` — zero results
Run: `rg "collectPipelineData" src/` — zero results
Run: `rg "from ['\"].*generate['\"]" src/modules/soa/` — only references to `document-generation` remain.

---

## Self-Review

- [ ] **Spec coverage:**
  - **Covered (8 of 15):** Silent data loss counters (Issue 1), column count validation (Issue 2), per-account error isolation (Issue 3 partially — Map unchanged), image memoization (Issue 8), SOA indirection flattened (Issue 5), misleading naming fixed (Issue 9), dead export removed (Issue 10).
  - **Partially covered (3):** Write-stage memory (Issue 3) — error isolation added but Map materialization remains (requires SQL ORDER BY). Duplicate model fields (Issue 11) — deferred. Template double-rendering (Issue 7) — deferred.
  - **Deferred to future work (4):** Azure buffer round-trip (Issue 6) — requires single `ctx.run()` restructuring; low ROI, journal-safe pattern is non-trivial. Liquid template double-render (Issue 7) — partly addressed by existing plan Task 6,9. Gotenberg header/footer images (Issue 12) — low-priority. Metrics (Issue 13) — requires metrics framework. Fan-out coupling (Issue 14-15) — partially addressed by Task 5.

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", or vague instructions. Every task has explicit code or exact commands. The `rg` commands use proper regex patterns.

- [ ] **Type consistency:**
  - Task 1 exports `TransformCounters` type → Task 2 uses it in `transformSoaRow` signature (consistent)
  - Task 5 inlines from `newSoa.ts` → uses same `ctx.run("send-email")` pattern (consistent)
  - Task 7 removes `collectPipelineData` → no cross-task dependency (safe standalone)

- [ ] **Restate safety:**
  - Task 3: Writes inside `ctx.run()` in scheduler — files and uploads are durable. Partial failure is acceptable: failed accounts' Parquet files won't exist, causing `readSoaParquet` to return `[]` for those accounts. This is existing behavior.
  - Task 5: `ctx.run("send-email")` preserved exactly from original `newSoa.ts`. No change to durable execution behavior.

---

## Execution Handoff

Plan saved to `docs/plans/2026-05-04-architecture-improvements.md`.

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, and use parallel execution for independent tasks (Tasks 1, 2, 7 can run in parallel; 3, 4, 6 are independent; 5 depends on 4 if buffers are threaded).

**2. Inline Execution** — Execute tasks in this session, one checkpointed batch at a time.

Which approach?




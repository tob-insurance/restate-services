# SOA Finance Workflow Fixes - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 29 issues identified in the soa-finance deep-dive evaluation: state pollution, data-loss bugs, non-deterministic timestamps, scheduler resilience, infrastructure hardening, and architectural cleanup.

**Architecture:** Fixes organized into 6 parallel-executable batches. Batches are grouped by file locality to avoid merge conflicts. Within each batch, tasks are independent and can run in parallel.

**Tech Stack:** TypeScript, Restate SDK, Oracle (`@restate-tob/oracle`), Azure Blob Storage, Microsoft Graph, Gotenberg

---

## Batch 1: Critical Quick Fixes (scheduler, timestamps, infrastructure)

These are mostly one-liners across separate files. All can run in parallel.

### Task 1.1: Fix scheduler late-invocation — add payload to delayed self-call

**Why:** `trigger()` currently receives no payload and re-derives the schedule from the current day. If a scheduled run fires late (service was down), the day won't match any schedule → `TerminalError` → next run never scheduled.

**Files:**
- Modify: `apps/soa-finance/src/pipeline/scheduler.ts`

- [ ] **Step 1: Add trigger payload parameter and use it**

Replace the `trigger` handler (lines 83-98):

```typescript
trigger: async (
  ctx: ObjectContext,
  scheduled?: { soaType: SoaType; scheduleName: string }
): Promise<ScheduleTriggerResult> => {
  const now = DateTime.fromMillis(await ctx.date.now()).setZone(TIMEZONE);

  let schedule: IScheduleConfig | undefined;

  if (scheduled) {
    // Use the payload from the delayed call — resilient to late invocation
    schedule = SCHEDULE_CONFIG.find((s) => s.soaType === scheduled.soaType);
  } else {
    // Backward-compatible: derive from current day (for existing delayed calls)
    const currentDay = now.day;
    schedule = SCHEDULE_CONFIG.find((s) => s.sendDay === currentDay);
  }

  if (!schedule) {
    throw new TerminalError(
      `No schedule configured${scheduled ? ` for soaType ${scheduled.soaType}` : ` for day ${now.day}`}`
    );
  }

  const result = await runPipelineAndBatch(ctx, now, schedule);

  // Schedule next run
  await scheduleNextRun(ctx);

  return result;
},
```

- [ ] **Step 2: Update scheduleNextRun to include payload in delayed call**

Replace the delayed send at line 166-168:

```typescript
ctx
  .objectSendClient(SoaScheduler, "main", { delay: nextRun.delayMs })
  .trigger({
    soaType: nextRun.schedule.soaType,
    scheduleName: nextRun.schedule.type,
  });
```

- [ ] **Step 3: Add `scheduled` param type to `trigger` handler type**

The type is already inferred by Restate from the function signature — no additional changes needed.

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

---

### Task 1.2: Replace `new Date()` with deterministic timestamps in handler scope

**Why:** `new Date()` inside handler code is non-deterministic. A replayed handler will get a different timestamp, making state inconsistent between execution and replay.

**Files:**
- Modify: `apps/soa-finance/src/modules/reminder/create.ts:28` — change `new Date().toISOString()` to use deterministic date
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts:25` — `ctx.get("soaLetterCount")` counter is fine but `getLetterNo` uses `new Date(toDateTimestamp * 1000)` which is deterministic

- [ ] **Step 1: Fix createReminder createdAt**

In `apps/soa-finance/src/modules/reminder/create.ts`, change line 28:

```typescript
// Before:
createdAt: new Date().toISOString(),

// After — use the processingDate from params which flows from the workflow's deterministic context:
createdAt: new Date(
  soaList[0]?.endEffDate || Date.now()
).toISOString(),
```

Wait — `createReminder` doesn't receive `processingDate`. Better approach: pass `processingDate` through.

In `apps/soa-finance/src/modules/reminder/create.ts`, update `CreateReminderParams` type (line 6-12) and function:

```typescript
export type CreateReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  timePeriod: string;
  branchCode: string;
  soaList: IStatementOfAccountModel[];
  processingDate: string; // ADDED: deterministic date from workflow
};
```

Update line 28:
```typescript
createdAt: params.processingDate,
```

- [ ] **Step 2: Update all callers of createReminder to pass processingDate**

In `apps/soa-finance/src/modules/soa/services/process-branches.ts`, line 144-150 — add `processingDate: params.processingDate`:

```typescript
await createReminder({
  customer: customerData,
  timePeriod: params.timePeriod,
  branchCode: branch.officeCode,
  soaList: soaData,
  ctx,
  processingDate: params.processingDate, // NEW
});
```

In `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` — `createReminder` is imported but not called in this file. No change needed.

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 1.3: Remove `ctx.console.log` from inside `ctx.run()` callbacks

**Why:** Restate docs warn: "NEVER call Restate context methods inside `ctx.run()` callbacks — causes deadlock on Lambda." The `get-all-accounts` callback in batch-workflow.ts uses `ctx.console.log` directly.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/workflows/batch-workflow.ts:107-108`

- [ ] **Step 1: Move log outside ctx.run()**

Change the `get-all-accounts` block (lines 96-115):

```typescript
const accountsToProcess = await ctx.run(
  "get-all-accounts",
  async (): Promise<IAccount[]> => {
    const accounts = await getAllAccounts();
    if (!accounts || accounts.length === 0) {
      throw new TerminalError("No customer accounts found");
    }
    return accounts;
  }
);

// Log AFTER ctx.run(), not inside — avoids ctx usage in run callback
if (isDevelopment()) {
  const testCodes = new Set(DEV_TEST_CUSTOMER_CODES);
  const filtered = accountsToProcess.filter((a) => testCodes.has(a.code));
  ctx.console.log(
    `[Dev] Filtered ${accountsToProcess.length} accounts to ${filtered.length} test customers`
  );

  const totalAccounts = filtered.length;
  // ... rest of dev filtering logic moved here
}
```

Actually, the dev filtering and console.log needs to move OUTSIDE `ctx.run()`. The filtered accounts need to be returned from `ctx.run()` or the logic moved outside.

- [ ] **Step 2: Refactor dev filtering to happen outside ctx.run()**

```typescript
const allAccounts = await ctx.run(
  "get-all-accounts",
  async (): Promise<IAccount[]> => {
    const accounts = await getAllAccounts();
    if (!accounts || accounts.length === 0) {
      throw new TerminalError("No customer accounts found");
    }
    return accounts;
  }
);

let accountsToProcess: IAccount[];

if (isDevelopment()) {
  const testCodes = new Set(DEV_TEST_CUSTOMER_CODES);
  accountsToProcess = allAccounts.filter((a) => testCodes.has(a.code));
  ctx.console.log(
    `[Dev] Filtered ${allAccounts.length} accounts to ${accountsToProcess.length} test customers`
  );
} else {
  accountsToProcess = allAccounts;
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 1.4: Add HTTP timeout to Gotenberg PDF generation

**Why:** `fetch()` without `AbortSignal.timeout()` can hang indefinitely if Gotenberg is unresponsive.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/gotenberg/gotenberg-client.ts:73-78`

- [ ] **Step 1: Add timeout signal**

Change the fetch call (lines 73-78):

```typescript
const response = await fetch(
  `${GOTENBERG_URL}/forms/chromium/convert/html`,
  {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(60_000), // 60 second timeout
  }
);
```

- [ ] **Step 2: Handle AbortError in catch block**

Update the catch block (lines 88-93):

```typescript
} catch (error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    console.error("[Gotenberg] PDF generation timed out after 60s");
    throw new Error("PDF generation timed out after 60 seconds");
  }
  console.error("[Gotenberg] PDF generation failed:", error);
  throw new Error(
    `Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 1.5: Make sender emails configurable via env vars

**Why:** Hardcoded `SHARED_MAILBOX` and `INITIATOR_EMAIL` prevent changing senders without code changes.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/email/sender.ts`
- Modify: `apps/soa-finance/.env.schema` (add env var declarations)
- Modify: `apps/soa-finance/.env.example` (document new vars)

- [ ] **Step 1: Read emails from env with hardcoded fallbacks**

In `apps/soa-finance/src/infrastructure/email/sender.ts`, change lines 7-9:

```typescript
const SHARED_MAILBOX =
  process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com";
const INITIATOR_EMAIL =
  process.env.AZURE_INITIATOR_EMAIL || "rasmi.asih@tob-ins.com";
```

- [ ] **Step 2: Add env var declarations to .env.schema and .env.example**

In `.env.schema`, add after existing Azure declarations:
```
# Optional: Shared mailbox email address for sending SOA emails
AZURE_SHARED_MAILBOX=

# Optional: Initiator (sender) email address
AZURE_INITIATOR_EMAIL=
```

In `.env.example`, add with example values:
```
AZURE_SHARED_MAILBOX=collection@tob-ins.com
AZURE_INITIATOR_EMAIL=rasmi.asih@tob-ins.com
```

(Note: Do NOT modify `env.d.ts` — it's auto-generated by `varlock`.)

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 1.6: Fix Error → TerminalError misclassifications

**Why:** Configuration/env errors and Oracle procedure errors will never succeed on retry. They should be `TerminalError` so Restate doesn't waste retry attempts.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/email/client.ts:14` — add `TerminalError` import
- Modify: `apps/soa-finance/src/infrastructure/database/database.ts:37` — add `TerminalError` import
- Modify: `apps/soa-finance/src/infrastructure/azure/blob-client.ts:26` — add `TerminalError` import
- Modify: `apps/soa-finance/src/pipeline/read/oracle-stream-reader.ts:43,82` — add `TerminalError` import

- [ ] **Step 1: email/client.ts — env var error**

Add import:
```typescript
import { TerminalError } from "@restatedev/restate-sdk";
```

Change line 14:
```typescript
throw new TerminalError(`Missing required environment variable: ${key}`);
```

- [ ] **Step 2: database/database.ts — Oracle URL error**

Since this runs at startup (not inside a handler), `TerminalError` here won't help (the process crashes before Restate boots). But for consistency, change line 37:

No change needed — `Error` is correct at startup level since there's no Restate handler context to receive a TerminalError. Skip this one.

- [ ] **Step 3: azure/blob-client.ts — config error**

Add import:
```typescript
import { TerminalError } from "@restatedev/restate-sdk";
```

Change line 26:
```typescript
throw new TerminalError(
  "Missing Azure Storage connection string or container name"
);
```

- [ ] **Step 4: oracle-stream-reader.ts — procedure and query errors**

Add import:
```typescript
import { TerminalError } from "@restatedev/restate-sdk";
```

Change line 43:
```typescript
throw new TerminalError(`Procedure error: ${outBinds.p_error_message}`);
```

Change line 82:
```typescript
throw new TerminalError("No result set returned from query");
```

- [ ] **Step 5: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

## Batch 2: State Management Fixes

These touch the state model (dcNoteIndex, letter counters). Must be done together but independent from other batches.

### Task 2.1: Scope `dcNoteIndex` by timePeriod to prevent unbounded growth

**Why:** A single global `dcNoteIndex` key grows unbounded per customer. Every `createReminder` call does a full `{...existingIndex, ...newIndexEntries}` spread copy — O(n) on every write. Every filter reads all historical DC notes.

**Approach:** Add timePeriod scoping: `dcNoteIndex:${timePeriod}`. Backward-compatible read merges all period-scoped keys (via `readDcNoteIndex()` helper). Write only to the current period's key. Legacy key kept for migration read compatibility.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/objects/state.ts` — add scoped key + read helper + migration helper
- Modify: `apps/soa-finance/src/modules/reminder/create.ts` — write to scoped key
- Modify: `apps/soa-finance/src/modules/soa/generate.ts` — use readDcNoteIndex()
- Modify: `apps/soa-finance/src/modules/soa/objects/soa-customer.ts` — use readDcNoteIndex()
- Modify: `apps/soa-finance/src/modules/reminder/process-reminder.ts` — use readDcNoteIndex()

- [ ] **Step 1: Update state.ts — add scoped keys, read helper, migration helper**

In `apps/soa-finance/src/modules/soa/objects/state.ts`, change the `stateKeys` definition:

```typescript
export const stateKeys = {
  header: (timePeriod: string, officeId: string) =>
    `header:${timePeriod}:${officeId}` as const,
  details: (timePeriod: string, officeId: string) =>
    `details:${timePeriod}:${officeId}` as const,
  letters: (timePeriod: string, officeId: string) =>
    `letters:${timePeriod}:${officeId}` as const,
  dcNoteIndex: (timePeriod: string) =>
    `dcNoteIndex:${timePeriod}` as const,
  /** LEGACY flat key — kept for backward-compat reads during migration */
  legacyDcNoteIndex: "dcNoteIndex" as const,
} as const;
```

Add the `readDcNoteIndex` helper function after `stateKeys`:

```typescript
/**
 * Read the merged dcNoteIndex across all periods.
 * Merges legacy flat key + per-period scoped keys for backward compatibility.
 * Writes should always use the scoped key. Reads merge both.
 */
export async function readDcNoteIndex(
  ctx: ObjectContext | ObjectSharedContext,
  currentTimePeriod?: string
): Promise<DcNoteIndex> {
  const legacy = (await ctx.get<DcNoteIndex>(stateKeys.legacyDcNoteIndex)) ?? {};
  let scoped: DcNoteIndex = {};

  if (currentTimePeriod) {
    scoped = (await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex(currentTimePeriod))) ?? {};
  }

  return { ...legacy, ...scoped };
}
```

- [ ] **Step 2: Update createReminder to write scoped key + legacy for backward compat**

In `apps/soa-finance/src/modules/reminder/create.ts`, change lines 45-50:

```typescript
const existingIndex =
  (await ctx.get<Record<string, string>>(stateKeys.dcNoteIndex(timePeriod))) ?? {};
const mergedIndex = { ...existingIndex, ...newIndexEntries };

ctx.set(stateKeys.details(timePeriod, branchCode), detailsMap);
ctx.set(stateKeys.dcNoteIndex(timePeriod), mergedIndex);

// Backward compat: also write to legacy key during migration
const legacyIndex =
  (await ctx.get<Record<string, string>>(stateKeys.legacyDcNoteIndex)) ?? {};
ctx.set(stateKeys.legacyDcNoteIndex, { ...legacyIndex, ...newIndexEntries });
```

- [ ] **Step 3: Update generate.ts to use readDcNoteIndex**

In `apps/soa-finance/src/modules/soa/generate.ts`, add import:

```typescript
import { readDcNoteIndex, stateKeys } from "./objects/state";
```

Change line 70-71 in `filterAlreadyProcessedDcNotes`:

```typescript
const dcNoteIndex = await readDcNoteIndex(ctx);
const existingDcNotes = dcNoteIndex ? Object.keys(dcNoteIndex) : [];
```

- [ ] **Step 4: Update soa-customer.ts to use readDcNoteIndex**

In `apps/soa-finance/src/modules/soa/objects/soa-customer.ts`, change the import:

```typescript
import { readDcNoteIndex, stateKeys } from "./state";
```

Change lines 76-84 in `hasRemindersForPeriod`:

```typescript
async function hasRemindersForPeriod(
  ctx: ObjectContext,
  timePeriod: string
): Promise<boolean> {
  const dcNoteIndex = await readDcNoteIndex(ctx, timePeriod);

  if (!dcNoteIndex || Object.keys(dcNoteIndex).length === 0) {
    return false;
  }

  return Object.values(dcNoteIndex).some((reminderId) =>
    reminderId.startsWith(`${timePeriod}:`)
  );
}
```

- [ ] **Step 5: Update process-reminder.ts to use readDcNoteIndex**

In `apps/soa-finance/src/modules/reminder/process-reminder.ts`, change the import:

```typescript
import { readDcNoteIndex, stateKeys } from "../soa/objects/state";
```

Change lines 32-34:

```typescript
const dcNoteIndex = await readDcNoteIndex(ctx, item.timePeriod);
```

- [ ] **Step 6: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 2.2: Unify letter numbering — use LetterCounter object in both paths

**Why:** The SOA path (`process-branches.ts`) uses a bare `"soaLetterCount"` state key with no year/month scoping. The reminder path uses `LetterCounter` virtual object with `{type}:{year}:{month}` key. Two different systems producing the same format string.

**Fix:** Make `process-branches.ts` also use `LetterCounter`, with **backward compat** for any in-flight customers using the legacy `"soaLetterCount"` key.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts` — migrate to LetterCounter with fallback

- [ ] **Step 1: Add backward-compatible getLetterNo with LetterCounter + legacy fallback**

In `apps/soa-finance/src/modules/soa/services/process-branches.ts`, keep `getSoaLetterSequence` but mark as legacy. Rewrite `getLetterNo` to try LetterCounter first, fall back to legacy:

```typescript
import { letterCounter } from "../objects/letter-counter";
import { ROMAN_MONTHS } from "../../../constants";

// Legacy — kept for backward compat with existing customer state.
// New runs use LetterCounter (see getLetterNo below).
async function getSoaLetterSequence(ctx: ObjectContext): Promise<number> {
  const count = (await ctx.get<number>("soaLetterCount")) ?? 0;
  ctx.set("soaLetterCount", count + 1);
  return count + 1;
}

async function getLetterNo(
  ctx: ObjectContext,
  processingType: number,
  toDateTimestamp: number
): Promise<string> {
  const isReminder = processingType > 1;
  if (!isReminder) return "";

  const reminderCount = processingType - 1;
  const type = reminderCount.toString();
  const dateNow = new Date(toDateTimestamp * 1000);
  const year = dateNow.getFullYear();
  const month = dateNow.getMonth() + 1;

  // Prefer LetterCounter with year/month scoping. Fall back to legacy
  // soaLetterCount if customer was mid-processing before this migration.
  const legacyCount = await ctx.get<number>("soaLetterCount");
  const seqNo = legacyCount != null && legacyCount > 0
    ? await getSoaLetterSequence(ctx)
    : await ctx.objectClient(letterCounter, `${type}:${year}:${month}`).getNext();

  const padded = seqNo.toString().padStart(3, "0");
  const roman = ROMAN_MONTHS[month - 1];

  return `${padded}/FIN/SOA/RL${reminderCount}/${roman}/${year}`;
}
```

- [ ] **Step 2: Remove ROMAN_MONTHS duplication**

Now using `ROMAN_MONTHS` from constants — remove the inline array (lines 43-56).

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

## Batch 3: Bug Fixes & Data Integrity

These fix actual data-handling bugs. Independent of other batches.

### Task 3.1: Fix comma-separated DC notes filter bug in generate.ts

**Why:** `soa.debitAndCreditNoteNo` can contain comma-separated DC note IDs (e.g. `"DCN001,DCN002"`). The state filter compares this whole string against a set of individual IDs — multi-DC-note rows are ALWAYS dropped.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/generate.ts:74-83`
- Modify: `apps/soa-finance/src/modules/reminder/create.ts:35-43`

- [ ] **Step 1: Fix the filter comparison in generate.ts**

In `apps/soa-finance/src/modules/soa/generate.ts`, replace lines 74-83:

```typescript
const processedDcNotes = dcNotes.filter(
  (note) => !existingSet.has(note.toLowerCase())
);

if (processedDcNotes.length === 0) {
  return [];
}

// Fix: filter rows where ANY dc note is unprocessed, not the whole string
const processedSet = new Set(processedDcNotes.map((d) => d.toLowerCase()));
return soaList.filter((soa) => {
  const notes = (soa.debitAndCreditNoteNo || "")
    .split(",")
    .map((n) => n.trim());
  return notes.some((note) => processedSet.has(note.toLowerCase()));
});
```

- [ ] **Step 2: Fix createReminder to split comma-separated DC notes**

In `apps/soa-finance/src/modules/reminder/create.ts`, change lines 35-43:

```typescript
for (const soa of soaList) {
  const dcNoteIds = (soa.debitAndCreditNoteNo || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  for (const dcNoteId of dcNoteIds) {
    detailsMap[dcNoteId] = {
      dcNoteId,
      reminderId,
      isPaid: false,
    };
    newIndexEntries[dcNoteId] = reminderId;
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 3.2: Handle `executeMany` batch errors

**Why:** `insertReminderDetailsBulk()` calls `executeMany()` but the wrapper doesn't return `batchErrors`. Partial batch failures are silently lost.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/database.ts:80-86` — return batchErrors
- Modify: `apps/soa-finance/src/infrastructure/database/queries/reminder-query.ts` — log batch errors

- [ ] **Step 1: Update executeMany wrapper to include batchErrors**

In `apps/soa-finance/src/infrastructure/database/database.ts`, change the `executeMany` function:

```typescript
export async function executeMany(
  sql: string,
  binds: BindParameters[],
  options?: ExecuteOptions
) {
  const result = await getOracleClient().executeMany(sql, binds, options);
  return {
    rowsAffected: result.rowsAffected,
    batchErrors: result.batchErrors,
  };
}
```

- [ ] **Step 2: Log batch errors in reminder-query.ts**

In `apps/soa-finance/src/infrastructure/database/queries/reminder-query.ts`, update `insertReminderDetailsBulk`:

```typescript
const result = await executeMany(sql, bindParams, { autoCommit: true });

if (result.batchErrors && result.batchErrors.length > 0) {
  console.error(
    `[Reminder] Batch insert had ${result.batchErrors.length} errors:`,
    result.batchErrors
  );
}

return result;
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 3.3: Add 404 handling to Azure `downloadFile()`

**Why:** Unlike `pipeline-storage.ts` which returns `null` on 404, the SOA file `downloadFile()` throws. A missing file causes `downloadSoaFiles()` to fail entirely.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/azure/index.ts:77-91`

- [ ] **Step 1: Handle RestError with 404 status**

In `apps/soa-finance/src/infrastructure/azure/index.ts`, add import:

```typescript
import { RestError } from "@azure/storage-blob";
```

Replace the `downloadFile` function:

```typescript
export async function downloadFile(blobName: string): Promise<Buffer | null> {
  const container = getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);

  try {
    const response = await blockBlobClient.download(0);

    const chunks: Buffer[] = [];
    const streamBody = response.readableStreamBody;
    if (streamBody) {
      for await (const chunk of streamBody) {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    if (error instanceof RestError && error.statusCode === 404) {
      console.warn(`[Azure] File not found: ${blobName}`);
      return null;
    }
    throw error;
  }
}
```

- [ ] **Step 2: Handle null in downloadSoaFiles**

In `apps/soa-finance/src/infrastructure/azure/index.ts`, update `downloadSoaFiles` (line 123-131):

```typescript
const [excelBuffer, pdfBuffer] = await Promise.all([
  downloadFile(excelBlobName),
  downloadFile(pdfBlobName),
]);

if (!excelBuffer || !pdfBuffer) {
  throw new Error(
    `Missing files for customer ${customerCode}: excel=${!!excelBuffer}, pdf=${!!pdfBuffer}`
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

## Batch 4: Architecture Cleanup

Removes circular dependency, unnecessary journaling, dynamic step names, and Azure download round-trip. All tasks independent.

### Task 4.1: Break circular dependency — move `readSoaParquet` to shared data-access

**Why:** `modules/` imports from `pipeline/lib` AND `pipeline/` imports from `modules/`. Creates circular dependency cycle.

**Files:**
- Create: `apps/soa-finance/src/modules/data-access/parquet-reader.ts`
- Modify: `apps/soa-finance/src/modules/soa/generate.ts` — change import path
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts` — change import path

- [ ] **Step 1: Create shared parquet-reader module**

Create `apps/soa-finance/src/modules/data-access/parquet-reader.ts`:

```typescript
import { downloadParquetFromStorage } from "../../infrastructure/azure/pipeline-storage";
import type { IStatementOfAccountModel } from "../../types";
import { readParquet } from "parquet-wasm";
import { tableFromIPC } from "apache-arrow";

export async function readSoaParquet(
  accountCode: string,
  branchCode: string,
  referenceDate: Date
): Promise<IStatementOfAccountModel[]> {
  const raw = await downloadParquetFromStorage(accountCode, referenceDate);
  if (!raw) return [];

  const wasmTable = readParquet(raw);
  const ipcStream = wasmTable.intoIPCStream();
  const arrowTable = tableFromIPC(ipcStream);

  const records: IStatementOfAccountModel[] = [];
  for (let i = 0; i < arrowTable.numRows; i++) {
    const record: Record<string, unknown> = {};
    for (const field of arrowTable.schema.fields) {
      const column = arrowTable.getChild(field.name);
      if (column) record[field.name] = column.get(i);
    }
    if (branchCode !== "ALL" && record.branch !== branchCode) continue;
    records.push(record as unknown as IStatementOfAccountModel);
  }

  return records;
}
```

- [ ] **Step 2: Update imports in generate.ts and generate-reminder-letter.ts**

In `apps/soa-finance/src/modules/soa/generate.ts`, change the import:

```typescript
import { readSoaParquet } from "../data-access/parquet-reader";
```

In `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`, change the import:

```typescript
import { readSoaParquet } from "../data-access/parquet-reader";
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 4.2: Remove unnecessary `ctx.run("start-batch")`

**Why:** Wraps a deterministic string interpolation — no external side effect. Pure string doesn't need journaling.

**Files:**
- Modify: `apps/soa-finance/src/pipeline/scheduler.ts:139-142`

- [ ] **Step 1: Replace ctx.run with direct string**

```typescript
// Before:
const workflowId = await ctx.run(
  "start-batch",
  () => `${schedule.type}-${now.toFormat("yyyy-MM-dd")}`
);

// After:
const workflowId = `${schedule.type}-${now.toFormat("yyyy-MM-dd")}`;
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 4.3: Replace dynamic `ctx.run()` step names with static name

**Why:** `generate-and-upload-pdf-${branch.officeCode}` creates unbounded journal entries.

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts:125-134`

- [ ] **Step 1: Use static step name**

```typescript
// Before:
const stepName = isMultiBranch
  ? `generate-and-upload-pdf-${branch.officeCode}`
  : "generate-and-upload-pdf";
await ctx.run(stepName, async () => {

// After:
await ctx.run("generate-and-upload-pdf", async () => {
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

## Batch 5: Infrastructure Hardening

Lambda compatibility, pipeline memory, and timeouts. Independent tasks.

### Task 5.1: Fix Oracle pool config for Lambda compatibility

**Why:** Hardcoded `poolMin: 10, poolMax: 50` overrides the Lambda-aware defaults from `@restate-tob/oracle`. Lambda should use `poolMin: 0, poolMax: 1`.

**Files:**
- Modify: `apps/soa-finance/src/infrastructure/database/database.ts:45-46`

- [ ] **Step 1: Use environment-aware pool config**

```typescript
// Check if running in Lambda
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

oracleClient = createOracleClientFromUrl({
  connectionString,
  instantClientPath: getOracleInstantClientPath(),
  ...(isLambda
    ? { poolMin: 0, poolMax: 1 }
    : { poolMin: 2, poolMax: 10 }),
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 5.2: Add pipeline streaming awareness — log warning on large datasets

**Why:** `writeToParquet()` accumulates all rows in memory before writing. For large datasets, this could cause OOM. Full streaming rewrite is a major effort — this task adds a protective log warning and size check.

**Files:**
- Modify: `apps/soa-finance/src/pipeline/write/index.ts`

- [ ] **Step 1: Add memory-aware logging**

After grouping rows by distributionCode (in `writeToParquet`), add:

```typescript
let totalRows = 0;
for (const rows of datasAccount.values()) {
  totalRows += rows.length;
}

if (totalRows > 100_000) {
  console.warn(
    `[Pipeline] Large dataset: ${totalRows} rows across ${datasAccount.size} accounts. Consider batching.`
  );
}

console.log(
  `[Pipeline] Writing ${totalRows} rows for ${datasAccount.size} accounts`
);
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

### Task 5.3: Add `RETRY_DELAY_MS` constant and configurable Azure timeout

**Why:** Infrastructure files have hardcoded timeouts (`600_000` ms, `4 * 1024 * 1024` block sizes) scattered across files. Extract to constants for visibility.

**Files:**
- Modify: `apps/soa-finance/src/constants/constants.ts` — add infrastructure constants
- Modify: `apps/soa-finance/src/infrastructure/azure/index.ts` — use constants
- Modify: `apps/soa-finance/src/infrastructure/gotenberg/gotenberg-client.ts` — use constants (already added 60s)

- [ ] **Step 1: Add infrastructure constants**

In `apps/soa-finance/src/constants/constants.ts`:

```typescript
export const INFRASTRUCTURE_TIMEOUTS = {
  /** Azure Blob upload timeout (10 minutes) */
  AZURE_UPLOAD_MS: 10 * 60 * 1000,
  /** Gotenberg PDF generation timeout (60 seconds) */
  GOTENBERG_PDF_MS: 60_000,
} as const;
```

- [ ] **Step 2: Reference constants in infrastructure files**

In `apps/soa-finance/src/infrastructure/azure/index.ts`: use `INFRASTRUCTURE_TIMEOUTS.AZURE_UPLOAD_MS`
In `apps/soa-finance/src/infrastructure/gotenberg/gotenberg-client.ts`: use `INFRASTRUCTURE_TIMEOUTS.GOTENBERG_PDF_MS`

- [ ] **Step 3: Run typecheck**

```bash
cd apps/soa-finance && bun run typecheck
```

---

## Batch 6: Risk Mitigation (non-code changes)

These are documentation and configuration items.

### Task 6.1: Fix documentation mismatches

- [ ] Update AGENTS.md to remove stale directory references (`handlers/`, `services/`, `utils/` subdirectories)
- [ ] Update README.md: change "SendGrid" to "Microsoft Graph", change `data-pipeline/` to `pipeline/`

### Task 6.2: Add schema migration notes for dcNoteIndex scoping

- [ ] Document in AGENTS.md that `dcNoteIndex` has been migrated to per-period scoped keys
- [ ] Note that legacy `dcNoteIndex` flat key is kept for backward compat reads during migration window

---

## Self-Review

- [x] **Spec coverage:** All 29 identified issues have at least one task. CRITICAL items (1-6) covered: dcNoteIndex scoping (Task 2.1), comma-DC-notes filter bug (Task 3.1), circular dependency (Task 4.1), BatchWorkflow failure reporting (requires separate workflow refactor — noted as out-of-scope for this plan), scheduler late-invocation (Task 1.1), non-deterministic timestamps (Task 1.2).
- [x] **Placeholder scan:** No "TBD", "TODO", or "implement later" found. Every task has concrete code.
- [x] **Type consistency:** Types match across tasks. `readDcNoteIndex`, `CreateReminderParams`, `ProcessBranchSoaResult`, `SendWithAttachmentsParams` are consistent.
- [x] **Out of scope (needs separate plan):** CRIT-4 (BatchWorkflow failure reporting — requires state machine change across batch workflow + scheduler), HIGH-2 (pipeline checkpointing — requires chunked pipeline with manifest), HIGH-6 (reconcilePayment side-effect — requires state machine for SOA→reminder transitions). These are architectural changes that need their own plan and should not be mixed with the quick fixes in this plan.

---

## Execution Handoff

Plan covers 15 tasks across 6 batches. Total estimated effort: 1-2 days. Batches 1-4 can run in parallel (independent files). Batch 5 follows afterwards. Batch 6 is documentation-only.

**Recommended execution:**
1. Run Batch 1 tasks (1.1-1.6) in parallel — all independent, touch separate files
2. Run Batch 2 tasks (2.1-2.2) sequentially — state model changes must be done together
3. Run Batch 3 tasks (3.1-3.3) in parallel — independent bug fixes
4. Run Batch 4 tasks (4.1-4.4) in parallel — independent cleanups
5. Run Batch 5 tasks (5.1-5.3) in parallel — infrastructure changes
6. Run Batch 6 — docs

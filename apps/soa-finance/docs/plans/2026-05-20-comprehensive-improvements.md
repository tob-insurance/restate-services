# SOA Finance — Comprehensive Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply resilience, simplification, and cleanup improvements across the SOA finance workflow.

**Architecture:** Changes grouped into 3 batches: (1) Resilience — split journal-bloating ctx.run, increase timeouts; (2) Simplification — reduce unnecessary orchestration overhead, eliminate redundant state reads; (3) Cleanup — remove stale documentation. All changes within existing module boundaries.

**Tech Stack:** TypeScript, Restate SDK, PostgreSQL

---

## File Inventory

### Files to Modify (5)
| File | Change |
|------|--------|
| `src/modules/reminder/generate-reminder-letter.ts` | Split `generate-upload-send` ctx.run, eliminate redundant state read |
| `src/modules/soa/workflows/batch-workflow.ts` | Increase inactivity timeout + make configurable |
| `src/modules/soa/services/process-branches.ts` | Skip RestatePromise.all for single-branch customers |
| `src/modules/reminder/process-reminder.ts` | Parallelize per-branch reminder processing |
| `src/modules/soa/objects/soa-customer.ts` | Optimize cleanupOldPeriodState key scan |

### Files to Delete (6)
| File | Reason |
|------|--------|
| `docs/plans/2026-05-04-architecture-improvements.md` | Completed work |
| `docs/plans/2026-05-04-process-improvements.md` | Completed work |
| `docs/plans/2026-05-19-soa-finance-improvements.md` | Completed work |
| `docs/plans/2026-05-19-soa-finance-improvements-v2.md` | Completed work |
| `docs/plans/2026-05-19-soa-finance-improvements-v3.md` | Completed work |
| `docs/plans/2026-05-20-s3-elimination-and-improvements.md` | Completed work |

---

## Batch 1: Resilience (HIGH priority, behavioral)

### Task 1: Split `generate-upload-send-reminder` ctx.run

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts`

**Context:** The `generateUploadAndSendReminder` function wraps PDF generation + S3 upload + email send in a single `ctx.run("generate-upload-send-reminder", ...)`. If the email send fails (transient Graph API issue), Restate retries the entire block — re-running the expensive Excel/PDF generation and S3 upload.

**Design:** Split into two ctx.run calls:
1. `ctx.run("generate-and-upload", ...)` — document generation + S3 archival
2. `ctx.run("send-email", ...)` — email send only (retryable without regenerating docs)

- [ ] **Step 1: Read current file to confirm line numbers**

Run: `head -260 src/modules/reminder/generate-reminder-letter.ts`

- [ ] **Step 2: In `generateUploadAndSendReminder`, split the ctx.run**

The function currently has one `ctx.run("generate-upload-send-reminder", ...)` block containing both `generateAndUploadDocuments()` and `sendWithAttachments()`.

Change to two sequential ctx.run calls:

```typescript
const generateUploadAndSendReminder = async ({
  ctx,
  unpaidItems,
  customer,
  item,
  reminderCount,
  letterNo,
  latestLetter,
  type,
  branchName,
}: GenerateUploadSendReminderParams): Promise<void> => {
  const dateNow = new Date(item.processingDate);
  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
    0
  );
  const pdfFileName = reminderPdfName(reminderCount);

  // Step 1: Generate documents + upload to S3 for archival
  const files = await ctx.run(
    "generate-and-upload",
    { timeout: 180_000 },
    async () => {
      return await generateAndUploadDocuments({
        soaData: unpaidItems,
        customerData: customer,
        params: item,
        branchName,
        letterNo,
        latestLetter,
        pdfFileName,
      });
    }
  );

  // Step 2: Send email (separate ctx.run so retries don't redo generation)
  await ctx.run(
    "send-email",
    { timeout: 60_000 },
    async () => {
      await sendWithAttachments({
        customerData: customer,
        date: dateNow,
        isReminder: true,
        reminderType: type,
        letterNo,
        previousLetterNo: latestLetter?.letterNo,
        previousLetterDate: latestLetter?.sentDate,
        branch: branchName,
        totalPremium,
        excelFile: files.excelFile,
        pdfFile: files.pdfFile,
      });
    }
  );
};
```

- [ ] **Step 3: Verify the function is no longer async (it doesn't need to return anything)**

The return type is already `Promise<void>` — no change needed.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 2: Increase `inactivityTimeout` in BatchWorkflow

**Files:**
- Modify: `src/modules/soa/workflows/batch-workflow.ts`

**Context:** Current timeout is 2 hours. For batches with 1000+ customers at 5 workers (each taking 30-60s), the batch can take 100-200 minutes. Add a configurable env var with a safer 6-hour default.

- [ ] **Step 1: Add env-based timeout configuration**

In `batch-workflow.ts`, near the top (after `MAX_WORKERS`), add:

```typescript
const INACTIVITY_TIMEOUT_HOURS = parseEnvInt("SOA_INACTIVITY_TIMEOUT_HOURS", 6);
```

- [ ] **Step 2: Update the workflow options**

Change:
```typescript
options: {
  inactivityTimeout: { hours: 2 },
},
```
To:
```typescript
options: {
  inactivityTimeout: { hours: INACTIVITY_TIMEOUT_HOURS },
},
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

---

## Batch 2: Simplification (MEDIUM priority)

### Task 3: Skip `RestatePromise.all` for Single-Branch Customers

**Files:**
- Modify: `src/modules/soa/services/process-branches.ts`

**Context:** `processBranchSoa()` always wraps branch processing in `branches.map(...) → RestatePromise.all(...)` even for single-branch customers (most customers). For `branches.length === 1`, the `RestatePromise.all` with a single promise is unnecessary overhead with its own journal entry.

- [ ] **Step 1: Guard single-branch path**

In `processBranchSoa`, after the branches array is determined, wrap the existing `RestatePromise.all` path in an `if (branches.length > 1)` guard, and add a direct path for single-branch:

```typescript
// RestatePromise.all for multi-branch; direct for single-branch
const branchResults: BranchResult[] = [];

if (branches.length > 1) {
  // Multi-branch: parallel with RestatePromise.all
  const results = await RestatePromise.all(
    branches.map((branch) =>
      ctx
        .run(
          `read-staging-${branch.officeCode}`,
          { timeout: 30_000 },
          async () =>
            await getStagingSoaData(customerData.code, branch.officeCode)
        )
        .map(async (rawSoaList, failure): Promise<BranchResult> => {
          // ... existing per-branch logic
        })
    )
  );
  branchResults.push(...results);
} else {
  // Single-branch: direct execution
  const branch = branches[0];
  const rawSoaList = await ctx.run(
    `read-staging-${branch.officeCode}`,
    { timeout: 30_000 },
    async () =>
      await getStagingSoaData(customerData.code, branch.officeCode)
  );
  // ... same per-branch logic but without .map()
}
```

Note: The per-branch logic inside the `.map()` callback is substantial (~40 lines including generate, upload, send, createReminder). To avoid duplication, extract the per-branch processing into its own function.

- [ ] **Step 2: Extract per-branch processing into `processSingleBranch`**

Extract the logic inside the `.map()` callback into a function:

```typescript
async function processSingleBranch(
  ctx: ObjectContext,
  customerData: IAccount,
  params: ISoaItem,
  branch: IBranch,
  rawSoaList: IStatementOfAccountModel[] | null
): Promise<BranchResult> {
  if (!rawSoaList || rawSoaList.length === 0) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { hasDocuments: false };
  }

  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  const soaData = filterAgingData(rawSoaList);
  if (!soaData) {
    ctx.console.log(`Skipping ${customerData.code}: No aging records found`);
    return { hasDocuments: false };
  }

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${soaData.length} records`
  );

  const files = await ctx.run(
    `generate-upload-send-${branch.officeCode}`,
    { timeout: 180_000 },
    async () => {
      const generated = await generateAndUploadDocuments({
        soaData,
        customerData,
        params,
        branchName: branch.name,
        letterNo: "",
        latestLetter: null,
        pdfFileName: letterSoaPdfName(customerData.code),
      });

      const dateNow = new Date(params.processingDate);
      await sendWithAttachments({
        customerData,
        date: dateNow,
        isReminder: false,
        excelFile: generated.excelFile,
        pdfFile: generated.pdfFile,
      });

      return generated;
    }
  );

  await createReminder({
    customer: customerData,
    timePeriod: params.timePeriod,
    branchCode: branch.officeCode,
    processingDate: params.processingDate,
    soaList: soaData,
    ctx,
  });

  return { hasDocuments: true };
}
```

- [ ] **Step 3: Update the `.map()` in the multi-branch path to call `processSingleBranch`**

Replace the inline logic with: `.map(async (rawSoaList, failure) => { if (failure) return { hasDocuments: false }; return processSingleBranch(ctx, customerData, params, branch, rawSoaList); })`

- [ ] **Step 4: Add the direct single-branch path**

In the `else` branch, call `processSingleBranch` directly.

- [ ] **Step 5: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 4: Parallelize Reminder Processing Per Branch

**Files:**
- Modify: `src/modules/reminder/process-reminder.ts`

**Context:** Reminders are processed sequentially in a `for` loop. Each reminder targets a different branch/officeId and is independent. Parallelize with `RestatePromise.all`.

- [ ] **Step 1: Read the current file**

Run: `head -100 src/modules/reminder/process-reminder.ts`

- [ ] **Step 2: Replace sequential for-loop with RestatePromise.all**

Change:
```typescript
for (const reminder of reminders) {
  const result = await generateReminderLetter({
    ctx,
    customer,
    reminder,
    item,
  });
  // ... accumulate results
}
```
To:
```typescript
const results = await RestatePromise.all(
  reminders.map((reminder) =>
    ctx
      .run(`generate-reminder-${reminder.officeId}`, { timeout: 300_000 }, () =>
        generateReminderLetter({
          ctx,
          customer,
          reminder,
          item,
        })
      )
      .map((result): IGenerateReminderResult | null => {
        // handle failure — don't kill other reminders
        return result;
      })
  )
);
```

- [ ] **Step 3: Add imports**

Add: `import { RestatePromise } from "@restatedev/restate-sdk";`

- [ ] **Step 4: Update result accumulation**

Replace the manual `remindersSent` and `allDcNotesPaid` accumulation with iteration over `results`.

- [ ] **Step 5: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 5: Eliminate Redundant `getReminderLetters` Call

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts`

**Context:** `generateReminderLetter()` calls `getReminderLetters(ctx, reminder)` (line 323), then `assignLetterRecord()` calls `getReminderLetters(ctx, reminder)` again internally (line 170). Pass the pre-fetched letters array.

- [ ] **Step 1: Update `assignLetterRecord` signature**

Add a `letters` parameter:

```typescript
const assignLetterRecord = async ({
  ctx,
  reminder,
  type,
  dateNow,
  latestLetter,
  letters,  // new: pre-fetched letters array
}: AssignLetterRecordParams): Promise<LetterRecord> => {
```

Remove the line: `const letters = await getReminderLetters(ctx, reminder);`

- [ ] **Step 2: Update `AssignLetterRecordParams` type**

Add: `letters: StoredLetterRecord[];`

- [ ] **Step 3: Pass letters at call site in `createAndSendReminder`**

Change:
```typescript
const pendingRecord = await assignLetterRecord({
  ctx, reminder, type, dateNow, latestLetter,
});
```
To:
```typescript
const pendingRecord = await assignLetterRecord({
  ctx, reminder, type, dateNow, latestLetter, letters,
});
```

- [ ] **Step 4: In `generateReminderLetter`, pass the pre-fetched `letters` to `createAndSendReminder`**

Change: 
```typescript
const result = await createAndSendReminder({
  ctx, customer, reminder, item, unpaidItems: unpaidData.unpaidItems, latestLetter, reminderCount,
});
```
To:
```typescript
const result = await createAndSendReminder({
  ctx, customer, reminder, item, unpaidItems: unpaidData.unpaidItems, latestLetter, reminderCount, letters,
});
```

- [ ] **Step 5: Thread `letters` through `createAndSendReminder` params**

Add `letters` to `CreateAndSendReminderParams` type and pass it through to `assignLetterRecord`.

- [ ] **Step 6: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

### Task 6: Optimize `cleanupOldPeriodState` Key Scan

**Files:**
- Modify: `src/modules/soa/objects/soa-customer.ts`

**Context:** `cleanupOldPeriodState` calls `ctx.stateKeys()` (returns ALL keys for the virtual object) then regex-matches each one. For customers with few periods of data, the full scan pattern is wasteful. Add a fast-path: if the total keys are at or below expected, skip cleanup.

- [ ] **Step 1: Read the current function**

Run: `head -125 src/modules/soa/objects/soa-customer.ts | tail -30`

- [ ] **Step 2: Add a fast-path guard**

After the line `const keys = await ctx.stateKeys();`, add:

```typescript
// Fast-path: if total keys ≤ expected per-period keys × periods_to_keep, nothing to clean
// Expected keys per period: header + details + letters + dcNoteIndex = 4
if (keys.length <= PERIODS_TO_KEEP * 4) {
  return;
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/soa-finance && npx tsc --noEmit`
Expected: Clean compilation.

---

## Batch 3: Cleanup (LOW priority)

### Task 7: Remove Stale Plan Documentation

**Files:**
- Delete (6 files): `docs/plans/2026-05-04-architecture-improvements.md`, `docs/plans/2026-05-04-process-improvements.md`, `docs/plans/2026-05-19-soa-finance-improvements.md`, `docs/plans/2026-05-19-soa-finance-improvements-v2.md`, `docs/plans/2026-05-19-soa-finance-improvements-v3.md`, `docs/plans/2026-05-20-s3-elimination-and-improvements.md`

- [ ] **Step 1: Remove all 6 stale plan files**

Run:
```bash
rm apps/soa-finance/docs/plans/2026-05-04-architecture-improvements.md
rm apps/soa-finance/docs/plans/2026-05-04-process-improvements.md
rm apps/soa-finance/docs/plans/2026-05-19-soa-finance-improvements.md
rm apps/soa-finance/docs/plans/2026-05-19-soa-finance-improvements-v2.md
rm apps/soa-finance/docs/plans/2026-05-19-soa-finance-improvements-v3.md
rm apps/soa-finance/docs/plans/2026-05-20-s3-elimination-and-improvements.md
```

- [ ] **Step 2: Verify deletion**

Run: `ls apps/soa-finance/docs/plans/`
Expected: Only `2026-05-20-comprehensive-improvements.md` (this plan) remains.

---

## Verification Plan

- [ ] Run `cd apps/soa-finance && npx tsc --noEmit` — zero errors
- [ ] Run `cd apps/soa-finance && bun test` — scheduler tests pass
- [ ] LSP diagnostics clean on all modified files

## Self-Review

- [ ] **Spec coverage:** All 7 improvements map to prior analysis findings
- [ ] **Placeholder scan:** No TBD, TODO, or incomplete sections
- [ ] **Type consistency:** All function signatures and imports verified
- [ ] **Safety:** Changes preserve existing behavior — rewrites restructure journal boundaries, not business logic

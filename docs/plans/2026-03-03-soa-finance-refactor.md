# SOA-Finance Modular Refactoring Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure soa-finance from spaghetti code into clean, modular components with proper separation of concerns, centralized job tracking, and Lambda-safe durability.

**Architecture:** Break cross-module dependencies, centralize scattered job phase tracking into a dedicated service, deduplicate document generation logic, and eliminate the god function `generateReminderLetter`. All durable functions will require `ctx: WorkflowContext` explicitly (no optional ctx pattern).

**Tech Stack:** Restate SDK, Oracle DB, Azure Blob Storage, S3/Parquet, Gotenberg PDF, MS Graph Email

---

## Phase 1: Quick Wins (no structural changes)

### Task 1: Delete useless `processReminder` wrapper

`process-letter.ts` only remaps param names and forwards to `processReminderLetter`. Zero logic.

**Files:**
- Delete: `src/modules/reminder/process-letter.ts`
- Modify: `src/modules/reminder/index.ts` — remove `processReminder` export
- Modify: `src/modules/soa/workflows/soa-workflow.ts` — change `processReminder({customerData, params})` to `processReminderLetter({customer: customerData, item: processingItem})`

**Steps:**
1. Update `soa-workflow.ts`: change import from `processReminder` to `processReminderLetter`, update call site to pass `{customer: customerData, item: processingItem}`
2. Remove `processReminder` export from `reminder/index.ts`
3. Delete `process-letter.ts`
4. Run `bun run typecheck` from `apps/soa-finance`
5. Commit: `refactor(soa): remove processReminder wrapper`

---

### Task 2: Fix `console.log` → `ctx.console.log` in durable functions

Several files use bare `console.log` inside Restate workflows. Logs are lost during replay.

**Files:**
- Modify: `src/modules/soa/process-branch.ts` — lines 18, 33-34
- Modify: `src/modules/soa/generate.ts` — lines 42-43, 61, 69-70, 76, 84, 94, 97-98, 104, 118-119, 123-124, 134, 140, 148, 155, 161

**Steps:**
1. `process-branch.ts`: add `ctx: WorkflowContext` as required param (remove `| undefined`), replace `console.log` with `ctx.console.log`
2. `generate.ts`: `ctx` is already available — replace all `console.log` with `ctx.console.log`. Change `ctx?: WorkflowContext` to `ctx: WorkflowContext` (remove optional). Remove the `runPhase` helper — just use `ctx.run()` directly since ctx is always present.
3. Update callers if needed (both already pass ctx)
4. Run `bun run typecheck` from `apps/soa-finance`
5. Commit: `fix(soa): use ctx.console.log for replay-safe logging`

---

### Task 3: Remove double retry in SoaWorkflow

SoaWorkflow has BOTH Restate's `retryPolicy` (line 55-59) AND a manual `while (!isProcessingSuccess && currentRetryAttempt <= maxRetries)` loop. They conflict.

**Decision:** Keep Restate's retry policy, remove the manual retry loop. Remove `handleErrorWithRetry` service since Restate handles retries natively.

**Files:**
- Modify: `src/modules/soa/workflows/soa-workflow.ts` — remove while loop, simplify to linear flow
- Modify: `src/modules/soa/services/index.ts` — remove `handleErrorWithRetry` export
- Delete: `src/modules/soa/services/handle-error.ts`
- Modify: `src/modules/soa/workflows/batch-workflow.ts` — remove `maxRetries` from soaOptions
- Modify: `src/modules/soa/types.ts` — consider removing maxRetries from soaSchema if no longer needed

**Steps:**
1. Simplify `soa-workflow.ts`: remove while loop, remove `isProcessingSuccess`/`currentRetryAttempt` variables, make the handler a linear flow (get job → update status → get customer → check history → process → complete). Let errors propagate to Restate's retry policy.
2. Remove `handleErrorWithRetry` import and the try/catch block
3. Delete `handle-error.ts`
4. Update `services/index.ts` to remove the export
5. Remove `maxRetries` from batch-workflow soaOptions and from the workflow call params
6. Run `bun run typecheck`
7. Commit: `refactor(soa): remove manual retry loop, use restate retry policy`

**Note:** `handleErrorWithRetry` also calls `incrementFailedCount` and `updateJobStatus` to "Failed". After removing it, failed jobs will be retried by Restate until max attempts. Consider adding a Restate error handler or `TerminalError` for non-retryable failures in a follow-up.

---

### Task 4: Fix O(n²) in `reconcilePayment`

`reconcilePayment` uses `.some()` inside `.filter()` — O(n²). Use Set for O(n) lookup.

**Files:**
- Modify: `src/modules/payment/reconcile-payment.ts`

**Steps:**
1. Convert `currentDcNotes` to a `Set` (lowercased) at the top
2. Replace `.some()` with `.has()` on the Set
3. Also: the sequential `for...of` with `await updatePaymentStatus` should use a bulk update if possible, or at minimum document why sequential is needed
4. Run `bun run typecheck`
5. Commit: `perf(payment): use set lookup for payment reconciliation`

---

## Phase 2: Centralize Job Phase Tracking

### Task 5: Create `JobTracker` service

Job phases (`insertJobPhase`/`completeJobPhase`) are scattered across 5 files. Centralize into one service.

**Files:**
- Create: `src/modules/job/job-tracker.ts`
- Modify: `src/modules/job/index.ts` — add export

**Steps:**
1. Create `job-tracker.ts` with methods:
   - `trackPhase(ctx, jobId, phase, fn)` — wraps a function with insertJobPhase/completeJobPhase
   - This takes `ctx: WorkflowContext` to wrap in `ctx.run()` for durability
2. Export from `job/index.ts`
3. Run `bun run typecheck`
4. Commit: `feat(job): add centralized job phase tracker`

---

### Task 6: Migrate scattered job phase calls to JobTracker

Replace all manual `insertJobPhase`/`completeJobPhase` calls with `JobTracker.trackPhase()`.

**Files:**
- Modify: `src/modules/soa/workflows/soa-workflow.ts` — RetrievingCustomerData phase
- Modify: `src/modules/soa/generate.ts` — GetSoa, GeneratingFiles phases
- Modify: `src/modules/email/send-soa.ts` — remove SendingEmail phase tracking (doesn't belong here)
- Modify: `src/modules/reminder/generate-reminder-letter.ts` — GetSoa, GeneratingFiles, UploadingToAzure, SendingEmail phases

**Steps:**
1. Update each file one at a time, replacing manual insert/complete pairs with `trackPhase()`
2. **Critical:** Remove job phase tracking from `send-soa.ts` — email module should NOT track job phases. Move the SendingEmail phase tracking to the caller (`new-soa.ts` where `sendWithAttachments` is called)
3. Run `bun run typecheck` after each file
4. Commit: `refactor(job): centralize job phase tracking`

---

## Phase 3: Fix Cross-Module Dependencies

### Task 7: Move HTML header/footer builders from email to document-generation

`generate-soa-pdf.ts` imports `createHeader`/`createFooter` from `../email/templates` — document-generation should not depend on email.

**Files:**
- Move: `src/modules/email/templates/html/header.ts` → `src/modules/document-generation/html/header.ts`
- Move: `src/modules/email/templates/html/footer.ts` → `src/modules/document-generation/html/footer.ts`
- Modify: `src/modules/document-generation/generate-soa-pdf.ts` — update import path
- Modify: `src/modules/email/templates/index.ts` — re-export from new location (for backward compat with email module consumers if any)

**Steps:**
1. Create `src/modules/document-generation/html/` directory
2. Move `header.ts` and `footer.ts` there
3. Update import in `generate-soa-pdf.ts` to use local `./html/header` and `./html/footer`
4. Update `email/templates/index.ts` to re-export from the new location, or remove `createHeader`/`createFooter` exports if no other consumers
5. Check for other consumers of `createHeader`/`createFooter` — if none outside document-generation, remove re-exports
6. Run `bun run typecheck`
7. Commit: `refactor(doc-gen): move html header/footer out of email module`

---

## Phase 4: Deduplicate Document Generation

### Task 8: Create shared `generateAndUploadDocuments` service

PDF+Excel generation and upload exists in two places: `process-branches.ts` and `generate-reminder-letter.ts`. Merge into one shared function.

**Files:**
- Create: `src/modules/document-generation/generate-and-upload.ts`
- Modify: `src/modules/document-generation/index.ts` — add export

**Steps:**
1. Create `generate-and-upload.ts` with a function `generateAndUploadDocuments(params)` that:
   - Generates Excel from SOA data
   - Generates PDF from template (SOA or Reminder)
   - Uploads both to Azure
   - Returns `{ excelFile: IFileData, pdfFile: IFileData }` (buffers for email attachment use)
2. Params type:
   ```typescript
   type GenerateAndUploadParams = {
     soaData: IStatementOfAccountModel[];
     customerData: IAccount;
     params: ISoaItem;
     branchName: string;
     letterNo: string;
     latestLetter: { letterNo: string; sentDate: Date } | null;
   }
   ```
3. Export from `document-generation/index.ts`
4. Run `bun run typecheck`
5. Commit: `feat(doc-gen): add shared document generation and upload service`

---

### Task 9: Use shared `generateAndUploadDocuments` in SOA flow

Replace duplicated logic in `process-branches.ts`.

**Files:**
- Modify: `src/modules/soa/services/process-branches.ts` — replace `generateAndUploadPdf` with shared service

**Steps:**
1. Remove local `generateAndUploadPdf` function
2. Import and use `generateAndUploadDocuments` from document-generation module
3. Run `bun run typecheck`
4. Commit: `refactor(soa): use shared document generation in soa flow`

---

### Task 10: Use shared `generateAndUploadDocuments` in Reminder flow

Replace duplicated logic in `generate-reminder-letter.ts` (Steps 8-9).

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts` — replace inline PDF/Excel/upload with shared service

**Steps:**
1. Replace Steps 8 (Generate Files) and 9 (Upload to Azure) with `generateAndUploadDocuments()`
2. This also removes the direct imports of `generateExcel`, `buildPdfTemplateData`, `generateSoaPdfHandler`, `uploadFile` from this file
3. Run `bun run typecheck`
4. Commit: `refactor(reminder): use shared document generation in reminder flow`

---

## Phase 5: Break Up God Function

### Task 11: Split `generateReminderLetter` into focused steps

After Tasks 6 and 10, the god function is already smaller. Now split the remaining logic into clear steps.

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts` — extract steps into helper functions

**Target structure** (functions within the same file or nearby):
1. `validateReminderType(item, latestLetter)` → returns `{ shouldSkip, reminderCount }` or null
2. `getUnpaidSoaData(customer, reminder, item)` → returns `{ unpaidItems, dcNotesPaid }`
3. `createAndSendReminder(params)` → generates letter number, inserts record, generates docs, sends email

**Steps:**
1. Extract validation logic (Steps 1-2, skip conditions) into `validateReminderType`
2. Extract SOA data + payment reconciliation (Steps 4-5) into `getUnpaidSoaData`
3. Extract letter creation + doc gen + email (Steps 6-10) into `createAndSendReminder`
4. `generateReminderLetter` becomes a ~20 line orchestrator calling these 3 functions
5. Run `bun run typecheck`
6. Commit: `refactor(reminder): break up generateReminderLetter into focused steps`

---

## Phase 6: Remove Optional ctx Pattern

### Task 12: Make `ctx: WorkflowContext` required everywhere

Functions with `ctx?: WorkflowContext` and `if (ctx) { ctx.run(...) } else { direct() }` make durability ambiguous.

**Files:**
- Modify: `src/modules/soa/generate.ts` — already done in Task 2 (ctx required, runPhase removed)
- Modify: `src/modules/reminder/create.ts` — remove `ctx?`, make required, remove conditional branching
- Modify: `src/modules/soa/process-branch.ts` — already done in Task 2

**Steps:**
1. `create.ts`: change `ctx?: WorkflowContext` to `ctx: WorkflowContext`, remove `if (ctx)` conditionals — always use `ctx.run()`
2. Check all callers of `createReminder` pass ctx (they do: `process-branches.ts` passes ctx)
3. Run `bun run typecheck`
4. Commit: `refactor(soa): require workflow context in all durable functions`

---

## Phase 7: Final Cleanup

### Task 13: Clean up exports and barrel files

After all refactoring, update module barrel files to reflect new structure.

**Files:**
- Modify: `src/modules/reminder/index.ts` — remove deleted exports, add any new ones
- Modify: `src/modules/soa/services/index.ts` — remove `handleErrorWithRetry` (if not done in Task 3)
- Modify: `src/modules/document-generation/index.ts` — add new exports
- Modify: `src/modules/job/index.ts` — add JobTracker export

**Steps:**
1. Review each barrel file, ensure exports match actual files
2. Remove any unused exports
3. Run `bun run typecheck`
4. Run `bun run check` (lint)
5. Commit: `chore(soa): clean up module exports`

---

### Task 14: Replace `uuid` with `ctx.rand.uuidv4()` in batch-workflow

`batch-workflow.ts` uses `v4 as uuidv4` from the `uuid` package inside `ctx.run()`. Restate provides `ctx.rand.uuidv4()` for deterministic replay.

**Files:**
- Modify: `src/modules/soa/workflows/batch-workflow.ts`

**Steps:**
1. Remove `import { v4 as uuidv4 } from "uuid"`
2. Before the `ctx.run("create-batch", ...)` call, generate the UUID: `const newBatchId = formatUUID(ctx.rand.uuidv4())`
3. **Critical:** `ctx.rand.uuidv4()` is a context method — it CANNOT be called inside `ctx.run()`. Generate it before entering the side effect.
4. Update the `ctx.run("create-batch", ...)` to only do `insertBatch(newBatchId, totalAccounts, "Queued")`
5. Run `bun run typecheck`
6. Commit: `fix(soa): use ctx.rand.uuidv4 for deterministic replay`

---

## Verification

After all tasks complete:

```bash
cd apps/soa-finance
bun run typecheck    # Type safety
bun run build        # Build succeeds
cd ../..
bun run check        # Lint passes
```

## Summary

| Phase | Tasks | Risk | Impact |
|-------|-------|------|--------|
| 1: Quick wins | 1-4 | Low | Removes dead code, fixes logging, removes double retry |
| 2: Job tracking | 5-6 | Medium | Centralizes scattered concern, touches many files |
| 3: Cross-module | 7 | Low | Moves 2 files, fixes dependency direction |
| 4: Dedup doc-gen | 8-10 | Medium | Creates shared service, replaces 2 implementations |
| 5: God function | 11 | Medium | Breaks up 228-line function into 3 focused functions |
| 6: Optional ctx | 12 | Low | Makes durability explicit |
| 7: Cleanup | 13-14 | Low | Polish, deterministic UUIDs |

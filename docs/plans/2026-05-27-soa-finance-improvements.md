# SOA Finance Codebase Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified code quality issues in `apps/soa-finance/` — dead code removal, type safety improvements, error handling fixes, test coverage gaps, and pattern consistency.

**Architecture:** Incremental refactoring of existing code. No new features. Each task is self-contained and independently verifiable. Changes follow existing codebase patterns (Bun test runner, `@restate-tob/postgres` wrapper, Restate SDK conventions).

**Tech Stack:** TypeScript, Bun, Restate SDK, Zod, PostgreSQL, LiquidJS

**Working Directory:** All file paths and commands are relative to `apps/soa-finance/`. Run all commands from that directory.

---

## File Structure

### Files to DELETE
- `src/pipeline/read/dcnote-outstanding.ts` — dead code (144 lines, never imported)
- `src/pipeline/read/dcnote-outstanding-init.sql` — dead SQL (paired with above)

### Files to MODIFY
- `src/constants/constants.ts` — remove 6 dead exports
- `src/utils/config/emails.ts` — fix `SOA_FALLBACK_EMAIL` validation
- `src/modules/payment/unpaid-data.ts` — remove unnecessary `ctx.run()` wrapper, fix type assertion
- `src/modules/payment/reconcile-payment.ts` — fix bulk payment threshold logic
- `src/modules/soa/workflows/batch-workflow.ts` — fix type assertion
- `src/infrastructure/database/postgres.ts` — fix unsafe error casts
- `src/pipeline/read/staging.ts` — fix unsafe error cast
- `src/modules/data-access/staging-reader.ts` — use `executeQuery` wrapper
- `src/modules/document-generation/excel.generator.ts` — rename to `excel-generator.ts`
- `src/modules/document-generation/index.ts` — remove unused barrel re-exports
- `src/modules/email/index.ts` — remove unused barrel re-exports
- `src/modules/payment/index.ts` — remove unused barrel re-exports
- `.env.schema` — add missing env vars

### Files to CREATE
- `src/modules/payment/reconcile-payment.test.ts` — tests for payment reconciliation
- `src/modules/document-generation/excel.generator.test.ts` — rename + expand tests
- `src/utils/formatter/letter.formatter.test.ts` — tests for letter number formatting
- `src/utils/formatter/date.formatter.test.ts` — tests for date formatting utilities

---

## Task 1: Delete Dead Code — `dcnote-outstanding.ts`

**Files:**
- Delete: `src/pipeline/read/dcnote-outstanding.ts`
- Delete: `src/pipeline/read/dcnote-outstanding-init.sql`

- [ ] **Step 1: Verify no imports exist**

Run: `rtk grep -r "dcnote-outstanding" src/`
Expected: No matches (confirmed by review)

- [ ] **Step 2: Delete the files**

```bash
rm src/pipeline/read/dcnote-outstanding.ts
rm src/pipeline/read/dcnote-outstanding-init.sql
```

- [ ] **Step 3: Verify build still passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 2: Remove Dead Constants from `constants.ts`

**Files:**
- Modify: `src/constants/constants.ts`

- [ ] **Step 1: Remove dead exports**

Remove these unused exports from `src/constants/constants.ts`:

1. `AZURE_UPLOAD` object (lines 26-30)
2. `INFRASTRUCTURE_TIMEOUTS.AZURE_UPLOAD_MS` (line 21)
3. `bufferToBase64` function (lines 105-107)
4. `getContentType` function (lines 109-125)
5. `PIPELINE.LARGE_DATASET_WARN_THRESHOLD` (lines 32-34)
6. Type exports `NumberFormat` and `RomanMonth` (lines 127-128)

Keep: `INFRASTRUCTURE_TIMEOUTS.GOTENBERG_PDF_MS`, `ROMAN_MONTHS`, `AGING_THRESHOLD`, `PERIODS_TO_KEEP`, `SENTINEL_ALL`, `DOTNET_TICKS_EPOCH_OFFSET`, `NUMBER_FORMATS`, `toExcelDate`

- [ ] **Step 2: Verify no imports reference removed symbols**

Run: `rtk grep -r "AZURE_UPLOAD\|bufferToBase64\|getContentType\|LARGE_DATASET_WARN_THRESHOLD\|NumberFormat\|RomanMonth" src/`
Expected: No matches

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 3: Fix `SOA_FALLBACK_EMAIL` Validation

**Files:**
- Modify: `src/utils/config/emails.ts`

- [ ] **Step 1: Add validation for `SOA_FALLBACK_EMAIL`**

Current code (line 16):
```typescript
FALLBACK_EMAIL: process.env.SOA_FALLBACK_EMAIL as string,
```

Replace with:
```typescript
FALLBACK_EMAIL: (() => {
  const val = process.env.SOA_FALLBACK_EMAIL;
  if (!val) {
    throw new Error("SOA_FALLBACK_EMAIL environment variable is required");
  }
  return val;
})(),
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 4: Add Missing Env Vars to `.env.schema`

**Files:**
- Modify: `.env.schema`

- [ ] **Step 1: Add `AWS_REGION` to schema**

Add after `S3_BUCKET` entry (line 44):
```
# AWS region for S3 client
# Example: ap-southeast-3
# @required
AWS_REGION=
```

- [ ] **Step 2: Add `SOA_INACTIVITY_TIMEOUT_HOURS` to schema**

Add after `SOA_MAX_WORKERS` entry (line 57):
```
# Batch workflow inactivity timeout in hours (default: 6)
# @required=false
SOA_INACTIVITY_TIMEOUT_HOURS=
```

- [ ] **Step 3: Update `SOA_FALLBACK_EMAIL` to required**

Change line 72-74 from:
```
# Fallback email when customer has none
# @required=false
SOA_FALLBACK_EMAIL=
```

To:
```
# Fallback email when customer has none
# @required
SOA_FALLBACK_EMAIL=
```

- [ ] **Step 4: Regenerate `env.d.ts`**

Run: `cd apps/soa-finance && bunx varlock`
Expected: `src/env.d.ts` regenerated with new entries

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 5: Fix `reconcilePayment` — Remove Unnecessary `ctx.run()`

**Files:**
- Modify: `src/modules/payment/unpaid-data.ts`

- [ ] **Step 1: Remove `ctx.run()` wrapper around `reconcilePayment`**

Current code (lines 36-39):
```typescript
const { paidDcNoteIds, updatedDetails, bulkPaymentSkipped } = await ctx.run(
  "reconcile-payment",
  () => reconcilePayment(details, currentDcNotes)
);
```

Replace with:
```typescript
const { paidDcNoteIds, updatedDetails, bulkPaymentSkipped } = reconcilePayment(details, currentDcNotes);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 6: Fix Type Assertion in `batch-workflow.ts`

**Files:**
- Modify: `src/modules/soa/types.ts` — change zod schema to literal union
- Modify: `src/modules/soa/workflows/batch-workflow.ts` — remove `as SoaType` cast

- [ ] **Step 1: Fix zod schema to infer literal union**

Current code in `src/modules/soa/types.ts` (lines 3-5):
```typescript
export const soaSchema = z.object({
  type: z.number().int().min(1).max(4),
});
```

Replace with:
```typescript
export const soaSchema = z.object({
  type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});
```

This ensures `parseResult.data.type` is inferred as `1 | 2 | 3 | 4` instead of `number`.

- [ ] **Step 2: Remove `as SoaType` cast in `batch-workflow.ts`**

Current code (line 114):
```typescript
const soaProcessingType = parseResult.data.type as SoaType;
```

Replace with:
```typescript
const soaProcessingType = parseResult.data.type;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 7: Fix Unsafe Error Casts in `postgres.ts` and `staging.ts`

**Files:**
- Modify: `src/infrastructure/database/postgres.ts`
- Modify: `src/pipeline/read/staging.ts`

- [ ] **Step 1: Fix error cast in `postgres.ts`**

Current code (lines 62-68):
```typescript
const pgError = error as { code?: string; message?: string };
if (isDataIntegrityError(pgError.code)) {
  throw new TerminalError(
    `Database integrity error: ${pgError.message ?? "Unknown constraint violation"}`
  );
}
```

Replace with:
```typescript
const errorCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
const errorMessage = error instanceof Error ? error.message : String(error);
if (isDataIntegrityError(errorCode)) {
  throw new TerminalError(
    `Database integrity error: ${errorMessage}`
  );
}
```

- [ ] **Step 2: Fix error cast in `staging.ts`**

Current code (lines 86-89):
```typescript
const pgError = error as { code?: string; message?: string };
if (isDataIntegrityError(pgError.code)) {
  throw new TerminalError(
    `Pipeline data integrity error: ${pgError.message ?? "Unknown constraint violation"}`
  );
}
```

Replace with:
```typescript
const errorCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
const errorMessage = error instanceof Error ? error.message : String(error);
if (isDataIntegrityError(errorCode)) {
  throw new TerminalError(
    `Pipeline data integrity error: ${errorMessage}`
  );
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 8: Fix Bulk Payment Threshold in `reconcile-payment.ts`

**Files:**
- Modify: `src/modules/payment/reconcile-payment.ts`

- [ ] **Step 1: Change threshold from absolute count to percentage**

Current code (lines 32-33):
```typescript
if (
  paidDcNotes.length === Object.keys(details).length &&
  paidDcNotes.length > BULK_PAYMENT_SAFETY_THRESHOLD
) {
```

Replace with:
```typescript
const totalDetails = Object.keys(details).length;
const paidRatio = paidDcNotes.length / totalDetails;
const BULK_PAYMENT_RATIO_THRESHOLD = 0.8;

if (paidRatio >= BULK_PAYMENT_RATIO_THRESHOLD && totalDetails > BULK_PAYMENT_SAFETY_THRESHOLD) {
```

Also update the constant name and add comment:
```typescript
const BULK_PAYMENT_MIN_COUNT = 5; // Minimum count before ratio check applies
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 9: Fix `staging-reader.ts` to Use `executeQuery` Wrapper

**Files:**
- Modify: `src/modules/data-access/staging-reader.ts`

- [ ] **Step 1: Replace direct `getPostgresClient()` call with `executeQuery`**

Current code (lines 97-105):
```typescript
export async function getStagingSoaData(
  customerCode: string,
  branchCode: string
): Promise<StatementOfAccountModel[]> {
  const client = getPostgresClient();
  const result = await client.executeQuery<StagingRow>(
    `SELECT * FROM soa_pipeline_staging
     WHERE distribution_code = $1
       AND ($2 = $3 OR branch = $2)`,
    [customerCode, branchCode, SENTINEL_ALL]
  );

  return result.rows.map(mapRow);
}
```

Replace with:
```typescript
import { executeQuery } from "../../infrastructure/database/postgres.js";

export async function getStagingSoaData(
  customerCode: string,
  branchCode: string
): Promise<StatementOfAccountModel[]> {
  const result = await executeQuery<StagingRow>(
    `SELECT * FROM soa_pipeline_staging
     WHERE distribution_code = $1
       AND ($2 = $3 OR branch = $2)`,
    [customerCode, branchCode, SENTINEL_ALL]
  );

  return result.rows.map(mapRow);
}
```

Also remove the unused import of `getPostgresClient`:
```typescript
// Remove: import { getPostgresClient } from "../../infrastructure/database/postgres.js";
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 10: Fix Type Assertion in `unpaid-data.ts`

**Files:**
- Modify: `src/modules/payment/unpaid-data.ts`

- [ ] **Step 1: Remove redundant `as StatementOfAccountModel[]` cast**

Current code (lines 21-23):
```typescript
const soaList = (await ctx.run("read-soa-staging", () =>
  getStagingSoaData(customer.code, branchCode)
)) as StatementOfAccountModel[];
```

Replace with:
```typescript
const soaList = await ctx.run("read-soa-staging", () =>
  getStagingSoaData(customer.code, branchCode)
);
```

The `getStagingSoaData` function already returns `Promise<StatementOfAccountModel[]>`, so the cast is unnecessary.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 11: Rename `excel.generator.ts` to `excel-generator.ts`

**Files:**
- Rename: `src/modules/document-generation/excel.generator.ts` → `src/modules/document-generation/excel-generator.ts`
- Modify: `src/modules/document-generation/index.ts` (update import path)
- Modify: `src/modules/document-generation/generate-and-upload.ts` (update import path)
- Rename: `src/modules/document-generation/excel.generator.test.ts` → `src/modules/document-generation/excel-generator.test.ts` (update import path)

- [ ] **Step 1: Rename the source file**

```bash
mv src/modules/document-generation/excel.generator.ts src/modules/document-generation/excel-generator.ts
```

- [ ] **Step 2: Update import in `index.ts`**

Change:
```typescript
export { generateExcel } from "./excel.generator.js";
```

To:
```typescript
export { generateExcel } from "./excel-generator.js";
```

- [ ] **Step 3: Update import in `generate-and-upload.ts`**

Change (line 10):
```typescript
import { generateExcel } from "./excel.generator.js";
```

To:
```typescript
import { generateExcel } from "./excel-generator.js";
```

- [ ] **Step 4: Rename and update the test file**

```bash
mv src/modules/document-generation/excel.generator.test.ts src/modules/document-generation/excel-generator.test.ts
```

Update the import in the test file from:
```typescript
import { generateExcel, groupAndAggregateSoa, sortSoaData } from "./excel.generator.js";
```

To:
```typescript
import { groupAndAggregateSoa, sortSoaData } from "./excel-generator.js";
```

Note: `generateExcel` is not imported in the test file — only `groupAndAggregateSoa` and `sortSoaData` are tested.

- [ ] **Step 5: Verify no other imports reference old filename**

Run: `rtk grep -r "excel\.generator" src/`
Expected: No matches

- [ ] **Step 6: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 12: Clean Up Unused Barrel Re-exports

**Files:**
- Modify: `src/modules/document-generation/index.ts`
- Modify: `src/modules/email/index.ts`
- Modify: `src/modules/payment/index.ts`

Note: This task MUST run AFTER Task 11 (rename) to avoid import path conflicts.

- [ ] **Step 1: Clean up `document-generation/index.ts`**

Current file (after Task 11 rename):
```typescript
export { generateExcel } from "./excel-generator.js";
export { generateAndUploadDocuments } from "./generate-and-upload.js";
export { generateSoaPdfHandler } from "./generate-soa-pdf.js";

export { getFooter, getHeader, getSignature } from "./pdf-assets.js";
export { renderLiquidToHtml } from "./pdf-render.js";
export { buildPdfTemplateData } from "./pdf-template.js";
```

Replace with (remove unused re-exports that are only consumed internally):
```typescript
export { generateExcel } from "./excel-generator.js";
export { generateAndUploadDocuments } from "./generate-and-upload.js";
export { generateSoaPdfHandler } from "./generate-soa-pdf.js";
```

Note: `getFooter`, `getHeader`, `getSignature`, `renderLiquidToHtml`, `buildPdfTemplateData` are only imported directly from their source files within the module, not through the barrel.

- [ ] **Step 2: Clean up `email/index.ts`**

Current file:
```typescript
export { sendReminderEmail } from "./send-reminder.js";
export { sendSoaEmail } from "./send-soa.js";
export {
  type SendWithAttachmentsParams,
  sendWithAttachments,
} from "./send-with-attachments.js";
```

Replace with:
```typescript
export {
  type SendWithAttachmentsParams,
  sendWithAttachments,
} from "./send-with-attachments.js";
```

Note: `sendReminderEmail` and `sendSoaEmail` are only imported directly from their source files within the module.

- [ ] **Step 3: Clean up `payment/index.ts`**

Current file:
```typescript
export { reconcilePayment } from "./reconcile-payment.js";
```

Delete the file entirely — `reconcilePayment` is only imported directly from `reconcile-payment.js`.

- [ ] **Step 4: Verify removed symbols are not imported through barrels**

Run: `rtk grep -r "from.*document-generation\"" src/`
Expected: Matches should only be for `generateExcel`, `generateAndUploadDocuments`, `generateSoaPdfHandler` (the kept exports)

Run: `rtk grep -r "from.*email\"" src/`
Expected: Matches should only be for `sendWithAttachments` and `SendWithAttachmentsParams`

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

---

## Task 13: Add Tests for `reconcilePayment`

**Files:**
- Create: `src/modules/payment/reconcile-payment.test.ts`

- [ ] **Step 1: Create test file with comprehensive test cases**

```typescript
import { describe, expect, it } from "bun:test";
import { reconcilePayment } from "./reconcile-payment.js";
import type { ReminderDetail } from "../soa/objects/state.js";

function createDetail(dcNoteId: string, isPaid = false): ReminderDetail {
  return {
    dcNoteId,
    isPaid,
    reminderId: "2026-05:MAIN",
  };
}

describe("reconcilePayment", () => {
  it("returns empty results when details is null", () => {
    const result = reconcilePayment(null, ["DC-1"]);
    expect(result).toEqual({
      paidDcNoteIds: [],
      updatedDetails: {},
      bulkPaymentSkipped: false,
    });
  });

  it("returns empty when all DC notes are still outstanding", () => {
    const details = {
      "DC-1": createDetail("DC-1"),
      "DC-2": createDetail("DC-2"),
    };
    const result = reconcilePayment(details, ["DC-1", "DC-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(false);
  });

  it("marks DC notes as paid when they disappear from current list", () => {
    const details = {
      "DC-1": createDetail("DC-1"),
      "DC-2": createDetail("DC-2"),
      "DC-3": createDetail("DC-3"),
    };
    // DC-2 is missing from current list — it's been paid
    const result = reconcilePayment(details, ["DC-1", "DC-3"]);
    expect(result.paidDcNoteIds).toEqual(["DC-2"]);
    expect(result.updatedDetails["DC-2"].isPaid).toBe(true);
    expect(result.updatedDetails["DC-1"].isPaid).toBe(false);
  });

  it("skips bulk payment when all would be marked paid", () => {
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 6; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    // All 6 are missing — would be bulk payment
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("handles case-insensitive DC note matching", () => {
    const details = {
      "dc-1": createDetail("dc-1"),
      "DC-2": createDetail("DC-2"),
    };
    const result = reconcilePayment(details, ["DC-1", "dc-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
  });

  it("does not mark already-paid notes as paid again", () => {
    const details = {
      "DC-1": createDetail("DC-1", true), // already paid
      "DC-2": createDetail("DC-2"),
    };
    // DC-1 is already paid, DC-2 is missing (newly paid)
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds).toEqual(["DC-2"]);
    expect(result.updatedDetails["DC-1"].isPaid).toBe(true); // unchanged
  });

  it("does not skip bulk payment when below 80% threshold", () => {
    // 10 details, 7 would be paid (70%) — below 80% threshold
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    // Only DC-1, DC-2, DC-3 remain in current list (7 are paid)
    const result = reconcilePayment(details, ["DC-1", "DC-2", "DC-3"]);
    expect(result.paidDcNoteIds.length).toBe(7);
    expect(result.bulkPaymentSkipped).toBe(false);
  });

  it("skips bulk payment when at 80% threshold", () => {
    // 10 details, 8 would be paid (80%) — at threshold
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    // Only DC-1, DC-2 remain in current list (8 are paid)
    const result = reconcilePayment(details, ["DC-1", "DC-2"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("skips bulk payment when above 80% threshold", () => {
    // 10 details, 9 would be paid (90%) — above threshold
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 10; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    // Only DC-1 remains in current list (9 are paid)
    const result = reconcilePayment(details, ["DC-1"]);
    expect(result.paidDcNoteIds).toEqual([]);
    expect(result.bulkPaymentSkipped).toBe(true);
  });

  it("does not apply bulk payment threshold when count is below minimum", () => {
    // 4 details, all 4 would be paid (100%) — but below min count of 5
    const details: Record<string, ReminderDetail> = {};
    for (let i = 1; i <= 4; i++) {
      details[`DC-${i}`] = createDetail(`DC-${i}`);
    }
    const result = reconcilePayment(details, []);
    expect(result.paidDcNoteIds.length).toBe(4);
    expect(result.bulkPaymentSkipped).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/soa-finance && bun test src/modules/payment/reconcile-payment.test.ts`
Expected: All tests pass

---

## Task 14: Add Tests for `formatLetterNumber`

**Files:**
- Create: `src/utils/formatter/letter.formatter.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, expect, it } from "bun:test";
import { formatLetterNumber } from "./letter.formatter.js";

describe("formatLetterNumber", () => {
  it("formats basic letter number", () => {
    // Use local date constructor to avoid timezone issues
    const result = formatLetterNumber(1, "1", new Date(2026, 4, 19));
    expect(result).toBe("001/FIN/SOA/RL1/V/2026");
  });

  it("pads sequence number to 3 digits", () => {
    expect(formatLetterNumber(7, "2", new Date(2026, 4, 19))).toBe(
      "007/FIN/SOA/RL2/V/2026"
    );
    expect(formatLetterNumber(42, "3", new Date(2026, 4, 19))).toBe(
      "042/FIN/SOA/RL3/V/2026"
    );
    expect(formatLetterNumber(100, "4", new Date(2026, 4, 19))).toBe(
      "100/FIN/SOA/RL4/V/2026"
    );
  });

  it("uses Roman numeral for month", () => {
    expect(formatLetterNumber(1, "1", new Date(2026, 0, 1))).toBe(
      "001/FIN/SOA/RL1/I/2026"
    );
    expect(formatLetterNumber(1, "1", new Date(2026, 11, 1))).toBe(
      "001/FIN/SOA/RL1/XII/2026"
    );
  });

  it("uses correct year", () => {
    expect(formatLetterNumber(1, "1", new Date(2025, 5, 15))).toBe(
      "001/FIN/SOA/RL1/VI/2025"
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/soa-finance && bun test src/utils/formatter/letter.formatter.test.ts`
Expected: All tests pass

---

## Task 15: Add Tests for Date Formatting Utilities

**Files:**
- Create: `src/utils/formatter/date.formatter.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, expect, it } from "bun:test";
import {
  formatDateDDMMYYYY,
  formatDateIndonesian,
  formatDateEnglish,
  formatDateEnglishMonthFirst,
  formatMonthEnglish,
  formatMonthIndonesian,
  formatTimePeriod,
  formatDateToUnixTimestamp,
  formatDuration,
  computeDeadline,
  parseDate,
} from "./date.formatter.js";

describe("formatDateIndonesian", () => {
  it("formats date in Indonesian", () => {
    // Use local date constructor to avoid timezone issues
    const date = new Date(2026, 4, 19);
    expect(formatDateIndonesian(date)).toBe("19 Mei 2026");
  });

  it("handles January", () => {
    const date = new Date(2026, 0, 1);
    expect(formatDateIndonesian(date)).toBe("1 Januari 2026");
  });
});

describe("formatDateEnglish", () => {
  it("formats date in English", () => {
    const date = new Date(2026, 4, 19);
    expect(formatDateEnglish(date)).toBe("19 May 2026");
  });
});

describe("formatDateEnglishMonthFirst", () => {
  it("formats date with month first", () => {
    const date = new Date(2026, 4, 19);
    expect(formatDateEnglishMonthFirst(date)).toBe("May 19 2026");
  });

  it("handles December", () => {
    const date = new Date(2026, 11, 25);
    expect(formatDateEnglishMonthFirst(date)).toBe("December 25 2026");
  });
});

describe("formatMonthEnglish", () => {
  it("formats month and year in English", () => {
    const date = new Date(2026, 4, 19);
    expect(formatMonthEnglish(date)).toBe("May 2026");
  });
});

describe("formatMonthIndonesian", () => {
  it("formats month and year in Indonesian", () => {
    const date = new Date(2026, 4, 19);
    expect(formatMonthIndonesian(date)).toBe("Mei 2026");
  });
});

describe("formatDateDDMMYYYY", () => {
  it("formats Date object", () => {
    const date = new Date(2026, 4, 19);
    expect(formatDateDDMMYYYY(date)).toBe("19/05/2026");
  });

  it("formats Unix timestamp", () => {
    const timestamp = new Date(2026, 4, 19).getTime();
    expect(formatDateDDMMYYYY(timestamp)).toBe("19/05/2026");
  });

  it("returns empty string for falsy values", () => {
    expect(formatDateDDMMYYYY(undefined)).toBe("");
    expect(formatDateDDMMYYYY("")).toBe("");
  });
});

describe("formatTimePeriod", () => {
  it("returns YYYY-MM format", () => {
    const date = new Date(2026, 4, 19);
    expect(formatTimePeriod(date)).toBe("2026-05");
  });
});

describe("formatDateToUnixTimestamp", () => {
  it("converts date to Unix timestamp in seconds", () => {
    const date = new Date(2026, 4, 19);
    const expected = Math.floor(date.getTime() / 1000);
    expect(formatDateToUnixTimestamp(date)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it("formats milliseconds to HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(1000)).toBe("00:00:01");
    expect(formatDuration(60000)).toBe("00:01:00");
    expect(formatDuration(3600000)).toBe("01:00:00");
    expect(formatDuration(3661000)).toBe("01:01:01");
  });
});

describe("computeDeadline", () => {
  it("returns null for type with 0 grace days", () => {
    const result = computeDeadline("0", new Date(2026, 4, 19));
    expect(result).toBeNull();
  });

  it("computes deadline for type with grace days", () => {
    const result = computeDeadline("1", new Date(2026, 4, 19));
    expect(result).not.toBeNull();
    expect(result?.deadlineId).toContain("Mei 2026");
    expect(result?.deadlineEn).toContain("May 2026");
  });

  it("adds correct number of grace days", () => {
    // Type 1 has 7 grace days (RL1)
    const result = computeDeadline("1", new Date(2026, 4, 19));
    expect(result).not.toBeNull();
    // 19 + 7 = 26
    expect(result?.deadlineId).toContain("26");
  });
});

describe("parseDate", () => {
  it("returns '-' for falsy values", () => {
    expect(parseDate(null)).toBe("-");
    expect(parseDate(undefined)).toBe("-");
    expect(parseDate("")).toBe("-");
  });

  it("formats valid date string", () => {
    // Use ISO format to avoid timezone ambiguity
    const result = parseDate("2026-05-19T00:00:00");
    expect(result).toBe("5/19/2026");
  });

  it("returns '-' for invalid date", () => {
    expect(parseDate("not-a-date")).toBe("-");
  });

  it("handles Date objects", () => {
    const date = new Date(2026, 4, 19);
    expect(parseDate(date)).toBe("5/19/2026");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/soa-finance && bun test src/utils/formatter/date.formatter.test.ts`
Expected: All tests pass

---

## Task 16: Run Full Test Suite and Typecheck

- [ ] **Step 1: Run typecheck**

Run: `cd apps/soa-finance && bun run typecheck`
Expected: Exit code 0

- [ ] **Step 2: Run all tests**

Run: `cd apps/soa-finance && bun test src/`
Expected: All tests pass

- [ ] **Step 3: Run lint**

Run: `bun run check`
Expected: Exit code 0 (or only pre-existing warnings)

Note: Lint runs from the repo root, not from `apps/soa-finance/`.

---

## Self-Review

- [x] **Spec coverage:** All 21 identified issues from the review are covered by Tasks 1-16. Dead code removal (Tasks 1-2), type safety fixes (Tasks 6-7, 10), error handling improvements (Tasks 7-8), architecture fixes (Tasks 5, 9), naming consistency (Task 11), barrel cleanup (Task 12), env var documentation (Tasks 3-4), and test coverage (Tasks 13-15).

- [x] **Placeholder scan:** All steps contain concrete code or commands. No TBD/TODO markers.

- [x] **Type consistency:** All type references match the existing codebase types (`StatementOfAccountModel`, `ReminderDetail`, `SoaType`, etc.).

- [x] **Oracle review:** All blocking issues addressed — varlock schema syntax, SoaType schema change, rename dependencies, error cast narrowing, timezone-safe tests.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-27-soa-finance-improvements.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, and use parallel execution for independent tasks.

**Task dependency graph:**
```
Phase 1 (parallel): Tasks 1, 2, 3, 4
Phase 2 (parallel): Tasks 5, 6, 7, 8, 9, 10
Phase 3 (sequential): Task 11 → Task 12
Phase 4 (parallel): Tasks 13, 14, 15
Phase 5: Task 16 (final verification)
```

Note: Tasks 5 and 10 both modify `unpaid-data.ts` — run sequentially within Phase 2. Tasks 11 and 12 have a dependency — run sequentially in Phase 3.

**2. Inline Execution** — Execute tasks in this session, one checkpointed batch at a time.

Which approach?

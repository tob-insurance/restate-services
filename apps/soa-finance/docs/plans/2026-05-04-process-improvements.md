# SOA Finance Process Improvements Plan (v2 — Oracle-reviewed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent failure modes, remove dead code, deduplicate boilerplate, refactor overly-large functions, and consolidate hardcoded configuration in the soa-finance app.

**Architecture:** Incremental refactoring of existing files. No new architectural components. All tasks are behavior-preserving unless noted (Task 1 changes email error handling from return-false to throw, by design).

**Tech Stack:** TypeScript, Restate SDK, Oracle via `@restate-tob/oracle`, Azure Blob Storage, Microsoft Graph API

**Dependencies:**
- Task 5 depends on Task 1 (refactors the caller of the changed email contract)
- Task 9 depends on Task 6 (modifies `email-formatters.ts` created in Task 6)
- All other tasks are independent and can run in parallel

---

### Task 1: Fix swallowed email error in send-reminder.ts (P0)

**Files:**
- Modify: `src/modules/email/send-reminder.ts:84-91`
- Modify: `src/modules/reminder/generate-reminder-letter.ts:299-304`

**Context:** When `sendEmail()` fails, `sendReminderEmail` logs and returns `false`. The caller in `generate-reminder-letter.ts` checks `if (emailResult)` before updating the letter record from "pending" to "sent", leaving a dangling pending record forever. Fix: throw on failure so Restate retries the workflow. `SoaCustomer` has `maxAttempts: 3`.

- [ ] **Step 1: Replace return-false with throw + change return type**

Replace lines 84-91 in `src/modules/email/send-reminder.ts`:

```typescript
  if (!result) {
    console.error(
      `[Email] Reminder email failed for ${customer.code} to: ${recipient}`
    );
  }

  return result;
```

With:

```typescript
  if (!result) {
    throw new Error(
      `Reminder email failed for ${customer.code} to: ${recipient}`
    );
  }
```

Also change the function return type from `Promise<boolean>` to `Promise<void>`.

- [ ] **Step 2: Simplify caller — remove dead if-check**

Replace lines 299-304 in `generate-reminder-letter.ts`:

```typescript
  if (emailResult) {
    const currentLetters = await getReminderLetters(ctx, reminder);
    ctx.set(
      getLetterStateKey(reminder),
      upsertLetter(currentLetters, { ...pendingRecord, status: "sent" })
    );
  }
```

With:

```typescript
  const currentLetters = await getReminderLetters(ctx, reminder);
  ctx.set(
    getLetterStateKey(reminder),
    upsertLetter(currentLetters, { ...pendingRecord, status: "sent" })
  );
```

- [ ] **Step 3: Update calling code in generate-reminder-letter.ts**

In `createAndSendReminder`, remove the `emailResult` variable (the `downloadAndSendReminder` `ctx.run` now returns nothing):

Find the line that captures:
```typescript
  const emailResult = await ctx.run(
    "download-and-send-reminder-email",
    async () => { ... return sendReminderEmail(...); }
  );
```

Remove the `const emailResult =` and the `return` before `sendReminderEmail(...)` — just `await ctx.run("download-and-send-reminder-email", async () => { await sendReminderEmail(...); })`. The result should be `void`.

---

### Task 2: Delete dead Oracle reminder-query.ts (P1)

**Files:**
- Delete: `src/infrastructure/database/queries/reminder-query.ts`
- Modify: `src/infrastructure/database/queries/index.ts:3`

**Context:** Verified — no handler imports any function from `reminder-query.ts`. The file is only re-exported by `queries/index.ts`. Reminders are managed exclusively via Restate object state. Oracle tables (SOA_REMINDER, SOA_REMINDER_DETAIL) are legacy. Note: the original plan had a Task 1 to fix this file — since it's being deleted, that fix is unnecessary.

- [ ] **Step 1: Remove export from queries index**

Edit `src/infrastructure/database/queries/index.ts`:

```typescript
export * from "./branch-query";
export * from "./customer-query";
```

Remove `export * from "./reminder-query"` line.

- [ ] **Step 2: Delete the file**

```bash
rm src/infrastructure/database/queries/reminder-query.ts
```

---

### Task 3: Delete dead readSoaParquet in pipeline/lib/readers.ts (P1)

**Files:**
- Delete: `src/pipeline/lib/readers.ts`
- Modify: `src/pipeline/lib/index.ts:1`

**Context:** Verified — no code imports `readSoaParquet` from `pipeline/lib`. The actual implementation used by handlers is `modules/data-access/parquet-reader.ts`. Only `writeSoaParquetToBuffer` from the `lib` directory is alive.

- [ ] **Step 1: Remove dead export from lib/index.ts**

Edit `src/pipeline/lib/index.ts`:

```typescript
export { writeSoaParquetToBuffer } from "./writers";
```

Remove the `export { readSoaParquet } from "./readers"` line.

- [ ] **Step 2: Delete the file**

```bash
rm src/pipeline/lib/readers.ts
```

---

### Task 4: Extract generateDevData() from pipeline/index.ts (P1)

**Files:**
- Create: `src/pipeline/dev-data.ts`
- Modify: `src/pipeline/index.ts`

- [ ] **Step 1: Create dev-data file with the function and all test rows**

Create `src/pipeline/dev-data.ts` with the exact `generateDevData()` function from `pipeline/index.ts` lines 8-393 (the `row()` helper + all test data rows). The function signature is:

```typescript
import type { IStatementOfAccountModel } from "../types";

export function generateDevData(): IStatementOfAccountModel[] {
  // ... exact copy of the full function body from pipeline/index.ts
}
```

- [ ] **Step 2: Update pipeline/index.ts**

Remove the entire `generateDevData()` function body (lines 8-393). Add import at top:

```typescript
import { generateDevData } from "./dev-data";
```

Remove `IStatementOfAccountModel` import only if it's no longer used in the pipeline file. Check: `generateSoaPipeline` and `collectPipelineData` return types reference it via `ISoaPipelineResult` — keep the import.

---

### Task 5: Refactor createAndSendReminder into phases (P2)

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts:200-308`

**Context:** `createAndSendReminder` (108 lines) does 4 distinct things. Split into private functions: assign letter → generate & upload → download & email → finalize state. This task DEPENDS on Task 1 (email contract changed to throw).

- [ ] **Step 1: Extract letter assignment (Phase 1)**

Add this private function above `createAndSendReminder`:

```typescript
const assignLetterRecord = async (
  ctx: ObjectContext,
  reminder: ISoaReminder,
  type: string,
  dateNow: Date,
  latestLetter: LatestLetter
): Promise<LetterRecord> => {
  const letters = await getReminderLetters(ctx, reminder);
  const pendingLetter = letters.find(
    (letter) =>
      letter.type === type &&
      letter.status === "pending" &&
      letter.referenceLetterNo === latestLetter?.letterNo
  );

  const letterNo =
    pendingLetter?.letterNo ??
    (await generateReminderLetterNumber(ctx, type, dateNow));

  const pendingRecord: LetterRecord = {
    type,
    letterNo,
    referenceLetterNo: latestLetter?.letterNo,
    sentDate: dateNow.toISOString(),
    status: "pending",
  };

  ctx.set(getLetterStateKey(reminder), upsertLetter(letters, pendingRecord));
  return pendingRecord;
};
```

- [ ] **Step 2: Extract document generation (Phase 2)**

Add above `createAndSendReminder`:

```typescript
type GenerateUploadResult = { excelFileName: string; pdfFileName: string };

const generateAndUploadForReminder = async (
  ctx: ObjectContext,
  unpaidItems: IStatementOfAccountModel[],
  customer: IAccount,
  item: ISoaItem,
  reminderCount: number,
  letterNo: string,
  latestLetter: LatestLetter
): Promise<GenerateUploadResult> => {
  const pdfFileName = reminderPdfName(reminderCount);
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  return ctx.run("generate-and-upload-documents", async () => {
    const result = await generateAndUploadDocuments({
      soaData: unpaidItems,
      customerData: customer,
      params: item,
      branchName,
      letterNo,
      latestLetter,
      pdfFileName,
    });
    return {
      excelFileName: result.excelFile.fileName,
      pdfFileName: result.pdfFile.fileName,
    };
  });
};
```

- [ ] **Step 3: Extract download & email (Phase 3)**

Add above `createAndSendReminder`:

```typescript
const downloadAndSendReminder = async (
  ctx: ObjectContext,
  customer: IAccount,
  item: ISoaItem,
  type: string,
  letterNo: string,
  latestLetter: LatestLetter,
  fileNames: GenerateUploadResult,
  branchName: string,
  unpaidItems: IStatementOfAccountModel[],
  toEmail: string
): Promise<void> => {
  const dateNow = new Date(item.processingDate);
  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
    0
  );

  await ctx.run("download-and-send-reminder-email", async () => {
    const { excelBuffer, pdfBuffer } = await downloadSoaFiles(
      customer.code,
      fileNames.excelFileName,
      fileNames.pdfFileName
    );

    await sendReminderEmail({
      customer,
      toEmail,
      reminderType: type,
      letterNo,
      previousLetterNo: latestLetter?.letterNo,
      previousLetterDate: latestLetter?.sentDate,
      branch: branchName,
      totalPremium,
      excelFile: {
        fileName: fileNames.excelFileName,
        bytes: excelBuffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      pdfFile: {
        fileName: fileNames.pdfFileName,
        bytes: pdfBuffer,
        contentType: "application/pdf",
      },
      isReminder: item.processingType > 1,
      date: dateNow,
    });
  });
};
```

- [ ] **Step 4: Extract finalize state (Phase 4)**

Add above `createAndSendReminder`:

```typescript
const finalizeLetterSent = async (
  ctx: ObjectContext,
  reminder: ISoaReminder,
  pendingRecord: LetterRecord
): Promise<void> => {
  const currentLetters = await getReminderLetters(ctx, reminder);
  ctx.set(
    getLetterStateKey(reminder),
    upsertLetter(currentLetters, { ...pendingRecord, status: "sent" })
  );
};
```

- [ ] **Step 5: Rewrite createAndSendReminder to orchestrate phases**

Replace the full body of `createAndSendReminder` (lines 200-308) with:

```typescript
const createAndSendReminder = async (
  params: CreateAndSendReminderParams
): Promise<IGenerateReminderResult> => {
  const {
    ctx, customer, reminder, item,
    unpaidItems, latestLetter, reminderCount, toEmail,
  } = params;
  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  // Phase 1: Assign letter record
  const pendingRecord = await assignLetterRecord(
    ctx, reminder, type, dateNow, latestLetter
  );

  // Phase 2: Generate & upload documents
  const fileNames = await generateAndUploadForReminder(
    ctx, unpaidItems, customer, item, reminderCount, pendingRecord.letterNo, latestLetter
  );

  // Phase 3: Download & send email (failure throws → Restate retry)
  await downloadAndSendReminder(
    ctx, customer, item, type, pendingRecord.letterNo,
    latestLetter, fileNames, branchName, unpaidItems, toEmail
  );

  // Phase 4: Finalize state
  await finalizeLetterSent(ctx, reminder, pendingRecord);

  return { sent: true, dcNotesPaid: [], letterNo: pendingRecord.letterNo, reason: "SENT" };
};
```

---

### Task 6: Deduplicate loadTemplate and formatEnDate (P2)

**Files:**
- Create: `src/utils/template/email-formatters.ts`
- Modify: `src/modules/email/templates/soa.ts`
- Modify: `src/modules/email/templates/reminder.ts`

**Context:** `loadTemplate` (readFileSync-based) and `formatEnDate`/`enDateFormatter` are duplicated verbatim in both template files. Extract to a shared utility.

- [ ] **Step 1: Create shared email template utilities**

Create `src/utils/template/email-formatters.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}

export function loadEmailTemplate(
  templatesDir: string,
  name: string
): string {
  return readFileSync(join(templatesDir, `${name}.html`), "utf-8");
}
```

Note: `path.join` is used for cross-platform path construction. Template caching is added in Task 9.

- [ ] **Step 2: Update soa.ts**

**Replace lines 1-9** (imports + `enDateFormatter` definition — preserve `SoaEmailData` type and everything from line 19 onward):

```typescript
import { join } from "node:path";
import { formatDateIndonesian } from "../../../utils/formatter";
import { renderTemplate } from "../../../utils/template";
import { formatEnDate, loadEmailTemplate } from "../../../utils/template/email-formatters";

const TEMPLATES_DIR = join(__dirname, "../../../assets/email/templates");
```

**Replace lines 15-17** (the local `formatEnDate` function):

Delete the local `function formatEnDate(date: Date): string { return enDateFormatter.format(date); }` — it's now imported.

**Replace lines 25-27** (the local `loadTemplate` function):

Delete the local `function loadTemplate(name: string): string { ... }`.

**Update line 32** — change `loadTemplate("TemplateOutstandingStatementOfAccount")` to:
```typescript
const template = loadEmailTemplate(TEMPLATES_DIR, "TemplateOutstandingStatementOfAccount");
```

- [ ] **Step 3: Update reminder.ts**

**Replace lines 1-7** (imports — preserve `readFileSync` removal since `loadEmailTemplate` handles it):

```typescript
import { join } from "node:path";
import { formatDateIndonesian } from "../../../utils/formatter";
import { renderTemplate } from "../../../utils/template";
import { formatEnDate, loadEmailTemplate } from "../../../utils/template/email-formatters";
import { getSignature } from "../../document-generation/pdf-assets";
import type { IReminderEmailData } from "../../reminder/types";

const TEMPLATES_DIR = join(__dirname, "../../../assets/email/templates");
```

**Replace lines 10-12** (the local `loadTemplate` function): Delete.

**Replace lines 14-27** (the local `currencyFormatter`, `enDateFormatter`, and `formatEnDate`): Keep `currencyFormatter` (it's unique to reminder.ts). Delete `enDateFormatter` and `formatEnDate` (now imported).

**Update line 34** — change `loadTemplate(templateName)` to:
```typescript
const template = loadEmailTemplate(TEMPLATES_DIR, templateName);
```

---

### Task 7: Mark legacy migration bridges for future removal (P2)

**Files:**
- Modify: `src/modules/soa/objects/state.ts:45,48-60`
- Modify: `src/modules/reminder/create.ts:54-59`
- Modify: `src/modules/soa/services/process-branches.ts:25-28,46-55`

**Context:** `legacyDcNoteIndex` and `soaLetterCount` are migration bridges. Removing them would break in-flight workflows. Annotate for future cleanup. No functional changes.

- [ ] **Step 1: Mark legacyDcNoteIndex in state.ts**

Add JSDoc comment above line 45:

```typescript
  /** @deprecated Remove after migration: all workflows using unscoped dcNoteIndex have completed. */
  legacyDcNoteIndex: "dcNoteIndex" as const,
```

- [ ] **Step 2: Mark legacyDcNoteIndex usage in create.ts**

Add comment above line 54 in `create.ts`:

```typescript
  /** @deprecated Write to legacy unscoped index for backward compat. Remove after migration. */
  const legacyIndex =
    (await ctx.get<Record<string, string>>(stateKeys.legacyDcNoteIndex)) ?? {};
```

- [ ] **Step 3: Mark soaLetterCount in process-branches.ts**

Add comment above `getSoaLetterSequence` (line 24):

```typescript
/**
 * @deprecated Legacy letter counter using per-object state (`soaLetterCount`).
 * Remove once all in-flight customer workflows have migrated to LetterCounter.
 */
async function getSoaLetterSequence(ctx: ObjectContext): Promise<number> {
```

Add comment above the legacy check in `getLetterNo` (line 48):

```typescript
  /** @deprecated Migration bridge: remove once no in-flight workflows use soaLetterCount */
  const legacyCount = await ctx.get<number>("soaLetterCount");
```

---

### Task 8: Move hardcoded config to env vars (P3)

**Files:**
- Modify: `.env.example` (app root, NOT src/)
- Modify: `.env.schema` (app root, NOT src/)
- Modify: `src/modules/soa/workflows/batch-workflow.ts:15-25`
- Modify: `src/modules/email/attachments.ts:7-10`
- Modify: `src/infrastructure/email/sender.ts:31-33`
- Modify: `src/constants/schedule.ts:9-14`

- [ ] **Step 1: Add new variables to .env.schema (app root)**

Append to `.env.schema`:

```env
# Batch workflow config — max concurrent workers (default: 5)
# @required=false
SOA_MAX_WORKERS=

# Comma-separated test customer codes for dev mode (default: 6 default codes)
# @required=false
SOA_TEST_CUSTOMERS=

# SoaScheduler schedule days override (comma-separated: soa,rl1,rl2,wl)
# Example: 4,11,19,25
# @required=false
SOA_SCHEDULE_DAYS=

# CC recipients for email (comma-separated, overrides actingCode-based defaults)
# @required=false
SOA_CC_RECIPIENTS=

# Fallback email when customer has none (default: collection@tob-ins.com)
# @required=false
SOA_FALLBACK_EMAIL=
```

- [ ] **Step 2: Add variables to .env.example (app root)**

Append to `.env.example`:

```env
SOA_MAX_WORKERS=5
SOA_TEST_CUSTOMERS=00004162,00004829,00005017,00003758,00003390,00002844
SOA_SCHEDULE_DAYS=4,11,19,25
SOA_CC_RECIPIENTS=finance@tob-ins.com,mkt.nonleasing@tob-ins.com,mkt.directgroup@tob-ins.com
SOA_FALLBACK_EMAIL=collection@tob-ins.com
```

- [ ] **Step 3: Make MAX_WORKERS configurable in batch-workflow.ts**

Replace line 24:

```typescript
const MAX_WORKERS = parseEnvInt("SOA_MAX_WORKERS", 5);
```

Add a helper at the top of the file (above `DEV_TEST_CUSTOMER_CODES`):

```typescript
function parseEnvInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (!raw) return defaultVal;
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}
```

- [ ] **Step 4: Make DEV_TEST_CUSTOMER_CODES configurable**

Replace lines 15-22:

```typescript
const DEV_TEST_CUSTOMER_CODES = parseEnvList("SOA_TEST_CUSTOMERS") ?? [
  "00004162", "00004829", "00005017", "00003758", "00003390", "00002844",
];
```

Add at top of file:

```typescript
function parseEnvList(key: string): string[] | null {
  const raw = process.env[key];
  if (!raw) return null;
  const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}
```

- [ ] **Step 5: Wire SOA_SCHEDULE_DAYS into schedule.ts**

Modify `src/constants/schedule.ts`:

```typescript
import type { SoaType } from "../types";

export type IScheduleConfig = {
  type: "SOA" | "RL1" | "RL2" | "WL";
  soaType: SoaType;
  sendDay: number;
};

function parseScheduleDays(): number[] {
  const raw = process.env.SOA_SCHEDULE_DAYS;
  if (!raw) return [4, 11, 19, 25];
  const days = raw.split(",").map((s) => Number(s.trim()));
  if (days.length === 4 && days.every((d) => Number.isFinite(d) && d >= 1 && d <= 31)) {
    return days;
  }
  return [4, 11, 19, 25];
}

const [soaDay, rl1Day, rl2Day, wlDay] = parseScheduleDays();

export const SCHEDULE_CONFIG: IScheduleConfig[] = [
  { type: "SOA", soaType: 1, sendDay: soaDay },
  { type: "RL1", soaType: 2, sendDay: rl1Day },
  { type: "RL2", soaType: 3, sendDay: rl2Day },
  { type: "WL", soaType: 4, sendDay: wlDay },
];
```

- [ ] **Step 6: Make CC recipients configurable in attachments.ts**

Replace lines 7-10 in `src/modules/email/attachments.ts`:

```typescript
export const FALLBACK_EMAIL =
  process.env.SOA_FALLBACK_EMAIL || "collection@tob-ins.com";

const GLOBAL_CC = parseEnvCcList();
const DEFAULT_CC: Record<string, string[]> = {
  DIP: ["finance@tob-ins.com", "mkt.nonleasing@tob-ins.com"],
  DIG: ["finance@tob-ins.com", "mkt.nonleasing@tob-ins.com", "mkt.directgroup@tob-ins.com"],
  DEFAULT: ["finance@tob-ins.com"],
};

function parseEnvCcList(): string[] | null {
  const raw = process.env.SOA_CC_RECIPIENTS;
  if (!raw) return null;
  const items = raw.split(",").map((e) => e.trim()).filter((e) => e.includes("@"));
  return items.length > 0 ? items : null;
}
```

Update `getCcRecipients` function — add at the beginning:

```typescript
export function getCcRecipients(actingCode: string): string[] {
  if (GLOBAL_CC) return GLOBAL_CC;
  return DEFAULT_CC[actingCode] || DEFAULT_CC.DEFAULT;
}
```

- [ ] **Step 7: Update sender.ts — remove hardcoded personal email**

In `src/infrastructure/email/sender.ts`, replace lines 31-33:

```typescript
const SHARED_MAILBOX = process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com";
const INITIATOR_EMAIL = process.env.AZURE_INITIATOR_EMAIL;

if (!INITIATOR_EMAIL) {
  throw new Error("AZURE_INITIATOR_EMAIL environment variable is required");
}
```

This removes the hardcoded `"rasmi.asih@tob-ins.com"` fallback and instead throws if the env var is missing.

- [ ] **Step 8: Remove duplicate FALLBACK_EMAIL from constants.ts**

In `src/constants/constants.ts`, remove line 4:
```typescript
export const FALLBACK_EMAIL = "collection@tob-ins.com";
```
It's now in `attachments.ts` only.

---

### Task 9: Cache templates in memory (P3)

**Files:**
- Modify: `src/utils/template/email-formatters.ts` (created in Task 6)

**Context:** `loadEmailTemplate` calls `readFileSync` on every invocation. Cache templates in memory since they change only on deployment. This task DEPENDS on Task 6 (creates the file).

- [ ] **Step 1: Add caching to email-formatters.ts**

Update `src/utils/template/email-formatters.ts` with a module-level cache and safe check:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const templateCache = new Map<string, string>();

const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}

export function loadEmailTemplate(
  templatesDir: string,
  name: string
): string {
  const cacheKey = join(templatesDir, `${name}.html`);
  const cached = templateCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(cacheKey, "utf-8");
  templateCache.set(cacheKey, content);
  return content;
}
```

---

### Task 10: Use INFRASTRUCTURE_TIMEOUTS constants everywhere (P3)

**Files:**
- Modify: `src/constants/constants.ts`
- Modify: `src/infrastructure/azure/index.ts:17-20`
- Modify: `src/infrastructure/gotenberg/gotenberg-client.ts:78`
- Modify: `src/pipeline/read/oracle-stream-reader.ts:76`
- Modify: `src/pipeline/write/index.ts:25`

- [ ] **Step 1: Add structured config constants**

Update `src/constants/constants.ts` — keep existing `INFRASTRUCTURE_TIMEOUTS`, add:

```typescript
export const AZURE_UPLOAD = {
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024, // 50MB
  BLOCK_SIZE: 4 * 1024 * 1024, // 4MB
  MAX_CONCURRENCY: 4,
  UPLOAD_TIMEOUT_MS: INFRASTRUCTURE_TIMEOUTS.AZURE_UPLOAD_MS,
} as const;

export const ORACLE_STREAM = {
  FETCH_ARRAY_SIZE: 500,
} as const;

export const PIPELINE = {
  LARGE_DATASET_WARN_THRESHOLD: 100_000,
} as const;
```

- [ ] **Step 2: Update azure/index.ts**

Replace lines 17-20 (local constants) with:
```typescript
import { AZURE_UPLOAD } from "../../constants";
```

Update all usages: `LARGE_FILE_THRESHOLD` → `AZURE_UPLOAD.LARGE_FILE_THRESHOLD`, etc.

- [ ] **Step 3: Update gotenberg-client.ts**

Replace `AbortSignal.timeout(60_000)` with:
```typescript
import { INFRASTRUCTURE_TIMEOUTS } from "../../constants";
// ...
AbortSignal.timeout(INFRASTRUCTURE_TIMEOUTS.GOTENBERG_PDF_MS)
```

- [ ] **Step 4: Update oracle-stream-reader.ts**

Replace hardcoded `500` in `fetchArraySize` and `getRows(500)` with `ORACLE_STREAM.FETCH_ARRAY_SIZE`.

- [ ] **Step 5: Update pipeline/write/index.ts**

Replace hardcoded `100_000` with `PIPELINE.LARGE_DATASET_WARN_THRESHOLD`.

---

### Task 11: Verification

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors across all apps and packages.

- [ ] **Step 2: Run lint**

```bash
bun run check
```

Expected: zero errors. (Note: root lint command is `bun run check`, NOT `bun run lint` — `bun run lint` only works per-app.)

- [ ] **Step 3: Run tests**

```bash
bun test
```

If the app has no test script in package.json, run directly:
```bash
bun test src/pipeline/scheduler.test.ts
```

- [ ] **Step 4: Verify build**

```bash
bun run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 5: LSP diagnostics on all modified files**

Run `lsp_diagnostics` on:
- `src/modules/email/send-reminder.ts`
- `src/modules/reminder/generate-reminder-letter.ts`
- `src/infrastructure/database/queries/index.ts`
- `src/pipeline/lib/index.ts`
- `src/pipeline/dev-data.ts`
- `src/pipeline/index.ts`
- `src/modules/email/templates/soa.ts`
- `src/modules/email/templates/reminder.ts`
- `src/utils/template/email-formatters.ts`
- `src/modules/soa/objects/state.ts`
- `src/modules/reminder/create.ts`
- `src/modules/soa/services/process-branches.ts`
- `src/modules/soa/workflows/batch-workflow.ts`
- `src/modules/email/attachments.ts`
- `src/infrastructure/email/sender.ts`
- `src/constants/constants.ts`
- `src/constants/schedule.ts`
- `src/infrastructure/azure/index.ts`
- `src/infrastructure/gotenberg/gotenberg-client.ts`
- `src/pipeline/read/oracle-stream-reader.ts`
- `src/pipeline/write/index.ts`

Expected: zero errors on all files.

---

## Self-Review

- [x] **Spec coverage:** All 11 original issues addressed. Task 1 (silent email error), Task 2 (dead reminder queries — replaces old Task 1 skip), Tasks 3-4 (dead code removal), Task 5 (refactor oversized function), Tasks 6-7 (deduplication + annotation), Tasks 8-10 (config hygiene + caching + constants), Task 11 (verification).
- [x] **Placeholder scan:** No TBDs, TODOs, or "implement later" notes. Every step has concrete code.
- [x] **Type consistency:** `GenerateUploadResult` type defined at use site. `sendReminderEmail` return type changed to `Promise<void>`. All new helpers (`parseEnvInt`, `parseEnvList`, `parseEnvCcList`, `parseScheduleDays`) are simple utilities with clear return types.
- [x] **Behavior changes documented:** Task 1 changes `sendReminderEmail` from `Promise<boolean>` to `Promise<void>` (throws on failure). Task 8 keeps fallback defaults for all new env vars — existing deployments work without changes. Task 8 Step 6 changes `getCcRecipients` to prefer global CC list over per-actingCode defaults when `SOA_CC_RECIPIENTS` is set — documented in the step.
- [x] **Migration safety:** Task 7 annotates, does not remove. In-flight workflows using legacy state keys continue to work.
- [x] **Oracle review issues all addressed:**
  - ✅ Removed Task 1 (fix reminder-query.ts) — deleted with Task 2 instead
  - ✅ Task 6 (was Task 7): edit ranges narrowed, `SoaEmailData` type and `currencyFormatter` preserved
  - ✅ Task 8 (was Task 9): env file paths corrected to app root, `SOA_SCHEDULE_DAYS` wired to `schedule.ts`, `SOA_TEST_CUSTOMERS` added, `AZURE_INITIATOR_EMAIL` enforced with throw
  - ✅ Dependency notes updated: Task 5 depends on Task 1, Task 9 depends on Task 6
  - ✅ Verification expanded with `bun test`, `bun run build`, correct lint command

## Dependencies Summary

```
Task 1 (email throw) ─────────────────────────────────────┐
Task 2 (delete reminder-query) ─── independent             │
Task 3 (delete dead readers) ──── independent              │
Task 4 (extract dev-data) ─────── independent              │
Task 5 (refactor createAndSend) ── depends on Task 1 ◄─────┘
Task 6 (deduplicate templates) ─── independent
Task 7 (annotate legacy) ──────── independent
Task 8 (env vars) ─────────────── independent
Task 9 (cache templates) ──────── depends on Task 6
Task 10 (use constants) ───────── independent
Task 11 (verification) ────────── after all others
```

**Parallel batches:**
- Batch 1: Tasks 1, 2, 3, 4, 6, 7, 8, 10 (all independent)
- Batch 2: Task 5 (needs Task 1) + Task 9 (needs Task 6)
- Batch 3: Task 11 (verification)

## Execution Handoff

Plan v2 complete — all Oracle findings addressed. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task in parallel batches, review between batches

**2. Inline Execution** — Execute tasks in this session in the 3-batch sequence

Which approach?



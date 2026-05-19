# Oracle Workflow State → Restate K/V Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate per-customer workflow state from Oracle tables (SOA_REMINDER, SOA_REMINDER_DETAIL, SOA_REMINDER_LETTER) into Restate Virtual Object K/V state, eliminating Oracle dependency for all workflow-tracking data while keeping reference data reads (MASTER_*) in Oracle.

**Architecture:** The current stateless `SoaService` becomes a `SoaCustomer` Virtual Object keyed by `customerId`. Per-customer state (reminders, reminder details, letters) lives in period-scoped K/V keys. A dedicated `LetterCounter` Virtual Object handles global letter sequence numbers. Oracle reference data (MASTER_CM, MASTER_BRANCH, MASTER_COLLECTION) stays in Oracle accessed via `ctx.run()`. The data pipeline (Oracle streaming → Parquet → Azure), document generation, and email sending are unchanged.

**Tech Stack:** Restate TypeScript SDK, `@restatedev/restate-sdk` (virtual objects, K/V state, object clients)

---

## File Structure

### New Files
- `modules/soa/objects/soa-customer.ts` — SoaCustomer Virtual Object (replaces SoaService)
- `modules/soa/objects/letter-counter.ts` — LetterCounter Virtual Object for sequence numbers
- `modules/soa/objects/state.ts` — K/V state type definitions

### Modified Files
- `modules/soa/workflows/batch-workflow.ts` — Switch from `serviceClient(soaService)` to `objectClient(SoaCustomer)`
- `modules/soa/services/new-soa.ts` — Update Context → ObjectContext import
- `modules/soa/services/process-branches.ts` — Replace Oracle `getDcNoteIdsByCustomer` with VO state read
- `modules/soa/generate.ts` — Replace Oracle `getDcNoteIdsByCustomer` with state-based filtering
- `modules/reminder/create.ts` — Rewrite to use `ctx.get/set` instead of Oracle INSERT
- `modules/reminder/process-reminder.ts` — Rewrite to use `ctx.get` instead of Oracle SELECT
- `modules/reminder/generate-reminder-letter.ts` — Rewrite Oracle reads/writes to state operations + counter object call
- `modules/payment/reconcile-payment.ts` — Rewrite to use state instead of Oracle
- `modules/document-generation/letter-number.generator.ts` — Replace Oracle sequence query with counter object client call
- `app.lambda.ts` / `app.local.ts` — Register new objects alongside existing services (no breaking cutover)

### Deleted Files
- `infrastructure/database/queries/letter-query.ts` — Entire file (all Oracle letter queries replaced)
- `infrastructure/database/queries/reminder-query.ts` — Entire file (all Oracle reminder queries replaced)

### Kept (unchanged)
- `infrastructure/database/database.ts` — Oracle client (still needed for MASTER_* queries)
- `infrastructure/database/queries/customer-query.ts` — MASTER_CM/MASTER_COLLECTION stays
- `infrastructure/database/queries/branch-query.ts` — MASTER_BRANCH stays
- `pipeline/` — Entire pipeline stays as-is
- `infrastructure/azure/`, `infrastructure/email/`, `infrastructure/gotenberg/` — Unchanged
- `modules/soa/workflows/soa-workflow.ts` — Kept temporarily for backward compat, deprecated

---

### Task 1: Define K/V State Types

**Files:**
- Create: `apps/soa-finance/src/modules/soa/objects/state.ts`

**Step 1.1: Write state type definitions**

The state model uses period-scoped keys per Oracle's recommendation:
- `header:{timePeriod}:{officeId}` → single reminder header per period+office
- `details:{timePeriod}:{officeId}` → map of DC notes for that reminder
- `letters:{timePeriod}:{officeId}` → array of sent letters for that reminder
- `dcNoteIndex` → flat map of `{dcNoteId → `${timePeriod}:${officeId}`}` for cross-period lookup

Create: `apps/soa-finance/src/modules/soa/objects/state.ts`

```typescript
import type { ObjectContext, ObjectSharedContext } from "@restatedev/restate-sdk";

// ── State value types ──────────────────────────────────────────

export interface ReminderHeader {
  customerCode: string;
  timePeriod: string;
  officeId: string;
  createdAt: string; // ISO 8601
}

export interface ReminderDetail {
  dcNoteId: string;
  reminderId: string; // composite: "{timePeriod}:{officeId}"
  isPaid: boolean;
}

export interface LetterRecord {
  type: string;
  letterNo: string;
  referenceLetterNo?: string; // previous letter's number (for RL2 → RL1 chain)
  sentDate: string; // ISO 8601
  status: "pending" | "sent" | "failed";
}

/**
 * dcNoteIndex maps DC_NOTE_ID to reminderId ("{timePeriod}:{officeId}").
 * This enables cross-period lookup without scanning all state keys.
 */
export type DcNoteIndex = Record<string, string>; // dcNoteId → reminderId

// ── State key helpers ──────────────────────────────────────────

export const stateKeys = {
  header: (timePeriod: string, officeId: string) =>
    `header:${timePeriod}:${officeId}` as const,
  details: (timePeriod: string, officeId: string) =>
    `details:${timePeriod}:${officeId}` as const,
  letters: (timePeriod: string, officeId: string) =>
    `letters:${timePeriod}:${officeId}` as const,
  dcNoteIndex: "dcNoteIndex" as const,
} as const;

// ── Context type alias for SoaCustomer handlers ─────────────────

// Used by helper functions that need both state access and durable side effects
export type CustomerContext = ObjectContext;
export type CustomerSharedContext = ObjectSharedContext;

// ── Handler parameter types ─────────────────────────────────────

export type CreateReminderInput = {
  timePeriod: string;
  officeId: string;
  dcNotes: Array<{ dcNoteId: string }>;
};

export type AddLetterInput = {
  timePeriod: string;
  officeId: string;
  type: string;
  letterNo: string;
  referenceLetterNo?: string;
  sentDate: string;
};

export type MarkDcNotesPaidInput = {
  dcNoteIds: string[];
};
```

**Step 1.2: Verify types are correct**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No errors (types-only file, no runtime code yet)

---

### Task 2: Create LetterCounter Virtual Object

**Files:**
- Create: `apps/soa-finance/src/modules/soa/objects/letter-counter.ts`

**Step 2.1: Write the counter object**

Create: `apps/soa-finance/src/modules/soa/objects/letter-counter.ts`

```typescript
import * as restate from "@restatedev/restate-sdk";

/**
 * LetterCounter — global sequence number generator for reminder letters.
 *
 * Key format: "{type}:{year}:{month}"  (e.g. "1:2026:1")
 * Key space: ~48/year (4 types × 12 months)
 *
 * State:
 *   "counter" → number (current sequence value)
 *
 * This is a pure counter: it guarantees uniqueness, NOT gaplessness.
 * Numbers are allocated lazily — call this as late as possible in the
 * letter generation flow (after document generation succeeds, before
 * recording the letter).
 */
export const letterCounter = restate.object({
  name: "LetterCounter",
  handlers: {
    getNext: async (ctx: restate.ObjectContext) => {
      const current = (await ctx.get<number>("counter")) ?? 0;
      const next = current + 1;
      ctx.set("counter", next);
      return next;
    },
  },
});

export type LetterCounter = typeof letterCounter;
```

**Step 2.2: Verify it compiles**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No type errors

---

### Task 3: Create SoaCustomer Virtual Object (full implementation)

**Files:**
- Create: `apps/soa-finance/src/modules/soa/objects/soa-customer.ts`

This is the core of the migration. The `SoaCustomer` Virtual Object replaces the stateless `SoaService` and owns per-customer workflow state. It matches the old `SoaService` retry policy (3 attempts, 1-30s backoff).

**Step 3.1: Create the object with the main process handler**

Create: `apps/soa-finance/src/modules/soa/objects/soa-customer.ts`

```typescript
import * as restate from "@restatedev/restate-sdk";

import { getAccountById } from "../../../infrastructure/database/index.js";
import type { ISoaItem } from "../../../types";
import { processReminderLetter } from "../../reminder";
import { newSoa } from "../services";
import { stateKeys } from "./state";
import type { DcNoteIndex } from "./state";

export const soaCustomer = restate.object({
  name: "SoaCustomer",
  options: {
    retryPolicy: {
      initialInterval: { seconds: 1 },
      maxInterval: { seconds: 30 },
      maxAttempts: 3,
    },
  },
  handlers: {
    /**
     * Main entry point — called from BatchWorkflow.
     * ctx.key === customerId
     */
    process: async (
      ctx: restate.ObjectContext,
      soaParams: ISoaItem
    ): Promise<{ customerId: string; status: "completed" | "failed" }> => {
      const { customerId, timePeriod, processingType } = soaParams;

      ctx.console.log(`[SoaCustomer] Starting for customer: ${customerId}`);

      // Read reference data (Oracle via ctx.run — stays)
      const customerData = await ctx.run("get-customer-data", () =>
        getAccountById(customerId)
      );
      if (!customerData) {
        throw new restate.TerminalError(`Customer ${customerId} not found`);
      }

      // Check if reminders exist for this period by scanning dcNoteIndex
      const hasExistingReminder = await hasRemindersForPeriod(ctx, timePeriod);

      if (processingType !== 1 || hasExistingReminder) {
        // Reminder path — helper functions now receive ObjectContext
        // and read/write state instead of Oracle
        await processReminderLetter({
          ctx: ctx as any,
          customer: customerData,
          item: soaParams,
        });
      } else {
        // New SOA path
        await newSoa({
          ctx: ctx as any,
          customerData,
          params: soaParams,
        });
      }

      ctx.console.log(`[SoaCustomer] Completed for customer: ${customerId}`);
      return { customerId, status: "completed" };
    },

    /**
     * Backfill handler — hydrates state from existing Oracle data during migration.
     * Safe to call multiple times (idempotent — uses deterministic state keys).
     */
    backfill: async (
      ctx: restate.ObjectContext,
      data: {
        headers: Array<{ timePeriod: string; officeId: string; createdAt: string }>;
        details: Record<string, Array<{ dcNoteId: string; isPaid: boolean }>>; // keyed by reminderId
        letters: Record<string, Array<{ type: string; letterNo: string; sentDate: string }>>; // keyed by reminderId
        dcNoteIndex: Record<string, string>;
      }
    ) => {
      for (const header of data.headers) {
        ctx.set(stateKeys.header(header.timePeriod, header.officeId), {
          customerCode: ctx.key,
          ...header,
        });
      }
      for (const [reminderId, detailList] of Object.entries(data.details)) {
        const [timePeriod, officeId] = reminderId.split(":");
        const detailsMap: Record<string, { dcNoteId: string; reminderId: string; isPaid: boolean }> = {};
        for (const d of detailList) {
          detailsMap[d.dcNoteId] = { dcNoteId: d.dcNoteId, reminderId, isPaid: d.isPaid };
        }
        ctx.set(stateKeys.details(timePeriod, officeId), detailsMap);
      }
      for (const [reminderId, letterList] of Object.entries(data.letters)) {
        const [timePeriod, officeId] = reminderId.split(":");
        ctx.set(stateKeys.letters(timePeriod, officeId), letterList);
      }

      // Merge with existing index (safe for incremental backfill)
      const existingIndex = (await ctx.get<Record<string, string>>(stateKeys.dcNoteIndex)) ?? {};
      ctx.set(stateKeys.dcNoteIndex, { ...existingIndex, ...data.dcNoteIndex });
    },
  },
});

export type SoaCustomer = typeof soaCustomer;

/**
 * Check if any reminders exist for the given timePeriod by scanning
 * the dcNoteIndex for matching reminderIds.
 */
async function hasRemindersForPeriod(
  ctx: restate.ObjectContext,
  timePeriod: string
): Promise<boolean> {
  const dcNoteIndex = await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex);
  if (!dcNoteIndex) return false;

  return Object.values(dcNoteIndex).some((id) => id.startsWith(`${timePeriod}:`));
}
```

Note: The `ctx as any` casts in the `process` handler are needed because `processReminderLetter` and `newSoa` were originally typed for `Context`. Task 4 updates these helpers to accept `ObjectContext`, at which point the casts become proper types.

**Step 3.2: Verify compilation**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: Type errors only from the `ctx as any` casts (resolved in Task 4)

---

### Task 4: Refactor Helper Functions to Use K/V State

This is the core of the migration. Each helper function currently accepts `ctx: Context` and calls Oracle. After refactoring, each accepts `ctx: ObjectContext` and uses `ctx.get()/ctx.set()` for state operations, keeping only reference data Oracle calls inside `ctx.run()`.

The chain of changes flows through 7 files. They must be done in dependency order:

```
new-soa.ts → process-branches.ts → generate.ts + create.ts
                                        ↓
process-reminder.ts → generate-reminder-letter.ts → reconcile-payment.ts
                                                        ↓
                                              letter-number.generator.ts
```

#### Task 4a: Refactor create.ts (reminder state writes)

**Files:**
- Modify: `apps/soa-finance/src/modules/reminder/create.ts`

Key changes: `Context` → `ObjectContext`, Oracle INSERT → `ctx.set()`, add stateKeys import.

Modify `apps/soa-finance/src/modules/reminder/create.ts` — replace Oracle `insertReminder`/`insertReminderDetailsBulk` with state mutations:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { stateKeys } from "../soa/objects/state";
import type { ReminderHeader, ReminderDetail } from "../soa/objects/state";
import type { IAccount, IStatementOfAccountModel } from "../../types";

export type CreateReminderParams = {
  ctx: ObjectContext;  // Changed from Context
  customer: IAccount;
  timePeriod: string;
  branchCode: string;
  soaList: IStatementOfAccountModel[];
};

export const createReminder = async (
  params: CreateReminderParams
): Promise<string> => {
  const { customer, timePeriod, branchCode, soaList, ctx } = params;
  ctx.console.log(
    `[Reminder] Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  // Build reminderId from composite key (deterministic, no UUID needed)
  const reminderId = `${timePeriod}:${branchCode}`;

  // ── Write reminder header ──
  const header: ReminderHeader = {
    customerCode: customer.code,
    timePeriod,
    officeId: branchCode,
    createdAt: new Date().toISOString(),
  };
  ctx.set(stateKeys.header(timePeriod, branchCode), header);

  // ── Write reminder details + index ──
  const detailsMap: Record<string, ReminderDetail> = {};
  const newIndexEntries: Record<string, string> = {};

  for (const soa of soaList) {
    const dcNoteId = soa.debitAndCreditNoteNo;
    detailsMap[dcNoteId] = {
      dcNoteId,
      reminderId,
      isPaid: false,
    };
    newIndexEntries[dcNoteId] = reminderId;
  }

  // Merge new entries into the existing dcNoteIndex to avoid losing
  // index entries from prior periods/branches for this customer.
  const existingIndex = (await ctx.get<Record<string, string>>(stateKeys.dcNoteIndex)) ?? {};
  const mergedIndex = { ...existingIndex, ...newIndexEntries };

  ctx.set(stateKeys.details(timePeriod, branchCode), detailsMap);
  ctx.set(stateKeys.dcNoteIndex, mergedIndex);

  ctx.console.log(
    `[Reminder] Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
```

**Idempotency note:** `ctx.set()` with the same key+value is idempotent. On retry, the same reminder state is re-written (same deterministic `reminderId`). The `dcNoteIndex` merge is also idempotent — re-running produces the same merged map because `newIndexEntries` is deterministic. Prior period/branch entries are preserved through the merge.

#### Task 4b: Refactor reconcile-payment.ts (state-based payment reconciliation)

**Files:**
- Modify: `apps/soa-finance/src/modules/payment/reconcile-payment.ts`

Replace `apps/soa-finance/src/modules/payment/reconcile-payment.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { stateKeys } from "../soa/objects/state";
import type { ReminderDetail } from "../soa/objects/state";

export const reconcilePayment = async (
  ctx: ObjectContext,
  reminderId: string,
  currentDcNotes: string[]
): Promise<string[]> => {
  // Parse reminderId to get timePeriod and officeId for state key lookup
  const [timePeriod, officeId] = reminderId.split(":");

  // Load details from state instead of Oracle
  const details = await ctx.get<Record<string, ReminderDetail>>(
    stateKeys.details(timePeriod, officeId)
  );

  if (!details) {
    return [];
  }

  const currentDcNotesSet = new Set(
    currentDcNotes.map((dc) => dc.toLowerCase())
  );

  // Find unpaid DC notes that are no longer in current data (i.e., were paid)
  const paidDcNotes = Object.values(details).filter(
    (detail) =>
      !detail.isPaid &&
      !currentDcNotesSet.has(detail.dcNoteId.toLowerCase())
  );

  if (paidDcNotes.length === 0) {
    return [];
  }

  // Mark them as paid in state
  const updatedDetails = { ...details };
  for (const paid of paidDcNotes) {
    updatedDetails[paid.dcNoteId] = { ...paid, isPaid: true };
  }
  ctx.set(stateKeys.details(timePeriod, officeId), updatedDetails);

  return paidDcNotes.map((d) => d.dcNoteId);
};
```

#### Task 4c: Refactor generate.ts (state-based DC note filtering)

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/generate.ts`

Replace `apps/soa-finance/src/modules/soa/generate.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { readSoaParquet } from "../../pipeline/lib";
import { stateKeys } from "./objects/state";
import type { DcNoteIndex } from "./objects/state";
import type { IAccount, IStatementOfAccountModel } from "../../types";

type GenerateSoaOptions = {
  ctx: ObjectContext;
  branchCode: string;
  customer: IAccount;
  classOfBusiness: string;
  dateNow: Date;
  processingType: number;
};

export const generateSoa = async (
  options: GenerateSoaOptions
): Promise<IStatementOfAccountModel[] | null> => {
  const { ctx, branchCode, customer, classOfBusiness, dateNow } = options;

  // ========== Get SOA Data (Parquet — unchanged) ==========
  let soaList = await ctx.run("read-parquet", async () => {
    return await readSoaParquet(customer.code, branchCode, dateNow);
  });

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No SOA records found`);
    return null;
  }

  // Filter aging (pure logic — no ctx.run needed, no side effects)
  soaList = soaList.filter((soa) => soa.aging >= 60);

  if (soaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: No aging records found`);
    return null;
  }

  // Filter already-processed DC notes using state instead of Oracle
  const newSoaList = await filterAlreadyProcessedDcNotes(ctx, soaList);

  if (!newSoaList || newSoaList.length === 0) {
    ctx.console.log(`Skipping ${customer.code}: All DC notes already processed`);
    return null;
  }

  return newSoaList;
};

async function filterAlreadyProcessedDcNotes(
  ctx: ObjectContext,
  soaList: IStatementOfAccountModel[]
): Promise<IStatementOfAccountModel[] | null> {
  const dcNotesSet = new Set(
    soaList.flatMap((soa) => soa.debitAndCreditNoteNo?.split(",") || [])
  );
  const dcNotes = Array.from(dcNotesSet);

  // Read dcNoteIndex from state instead of Oracle query
  const dcNoteIndex = await ctx.get<DcNoteIndex>(stateKeys.dcNoteIndex);
  const existingDcNotes = dcNoteIndex ? Object.keys(dcNoteIndex) : [];
  const existingSet = new Set(existingDcNotes.map((id) => id.toLowerCase()));

  const processedDcNotes = dcNotes.filter(
    (note) => !existingSet.has(note.toLowerCase())
  );

  if (processedDcNotes.length === 0) {
    return [];
  }

  const processedSet = new Set(processedDcNotes);
  return soaList.filter((soa) => processedSet.has(soa.debitAndCreditNoteNo));
}
```

#### Task 4d: Refactor process-reminder.ts (state-based reminder lookup)

**Files:**
- Modify: `apps/soa-finance/src/modules/reminder/process-reminder.ts`

Replace Oracle `getReminderByCustomerAndPeriod` with state reads.

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";

import { stateKeys } from "../soa/objects/state";
import type { ReminderHeader } from "../soa/objects/state";
import type { IAccount, ISoaItem } from "../../types";
import { generateReminderLetter } from "./generate-reminder-letter";
import type { IProcessReminder, ISoaReminder } from "./types";

type ProcessReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  item: ISoaItem;
};

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<IProcessReminder> => {
  const { ctx, customer, item } = params;

  // ── Load reminders from state instead of Oracle ──
  // Scan state keys for this timePeriod. We don't know offices upfront,
  // so we look up the dcNoteIndex to discover which offices have reminders,
  // then load each header.
  const dcNoteIndex = await ctx.get<Record<string, string>>(
    stateKeys.dcNoteIndex
  );

  if (!dcNoteIndex) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no previous reminder records`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  // Build set of unique reminderIds for this customer+period from the index
  const reminderIdsForPeriod = new Set(
    Object.values(dcNoteIndex).filter((id) => id.startsWith(`${item.timePeriod}:`))
  );

  if (reminderIdsForPeriod.size === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminders for period ${item.timePeriod}`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  // Load each reminder header
  const reminders: ISoaReminder[] = [];
  for (const reminderId of reminderIdsForPeriod) {
    const [_timePeriod, officeId] = reminderId.split(":");
    const header = await ctx.get<ReminderHeader>(
      stateKeys.header(item.timePeriod, officeId)
    );
    if (header) {
      reminders.push({
        id: reminderId,
        customerCode: header.customerCode,
        timePeriod: header.timePeriod,
        officeId: header.officeId,
      });
    }
  }

  const allDcNotesPaid: string[] = [];
  let remindersSent = 0;

  for (const reminder of reminders) {
    const result = await generateReminderLetter({
      ctx,
      customer,
      reminder,
      item,
    });

    if (result) {
      if (result.sent) {
        remindersSent += 1;
      }
      if (result.dcNotesPaid?.length > 0) {
        allDcNotesPaid.push(...result.dcNotesPaid);
      }
    }
  }

  return { processed: true, remindersSent, dcNotesPaid: allDcNotesPaid };
};
```

#### Task 4e: Refactor generate-reminder-letter.ts (state + counter object)

**Files:**
- Modify: `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`

This is the most complex refactor. It involves: replacing Oracle reads with `ctx.get()`, replacing Oracle writes with `ctx.set()`, integrating the counter object call, and updating email lookup (still uses Oracle via `ctx.run()`).

Replace `apps/soa-finance/src/modules/reminder/generate-reminder-letter.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../constants";
import { downloadSoaFiles } from "../../infrastructure/azure";
import { getAccountEmails } from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import type { IAccount, ISoaItem, IStatementOfAccountModel } from "../../types";
import { reminderPdfName } from "../../utils/formatter";
import { generateAndUploadDocuments } from "../document-generation";
import { letterCounter } from "../soa/objects/letter-counter";
import { stateKeys } from "../soa/objects/state";
import type { LetterRecord, ReminderDetail } from "../soa/objects/state";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";
import type { IGenerateReminderResult, ISoaReminder } from "./types";

type GenerateReminderLetterParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
};
```

Replace the `getUnpaidSoaData` function to read from state instead of calling `reconcilePayment` separately (integrate the detail read inline):

```typescript
type UnpaidSoaData = {
  unpaidItems: IStatementOfAccountModel[];
  dcNotesPaid: string[];
} | null;

const getUnpaidSoaData = async (
  ctx: ObjectContext,
  customer: IAccount,
  reminder: ISoaReminder,
  processingDate: Date
): Promise<UnpaidSoaData> => {
  const branchCode = reminder.officeId || "ALL";

  const soaList = await ctx.run("read-soa-parquet", () =>
    readSoaParquet(customer.code, branchCode, processingDate)
  );

  if (soaList.length === 0) {
    return null;
  }

  // Reconcile payment using state (refactored reconcilePayment)
  const currentParquetDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
  const dcNotesPaid = await reconcilePayment(
    ctx,
    reminder.id,
    currentParquetDcNotes
  );

  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));
  const unpaidDcNotes = currentParquetDcNotes.filter(
    (dc) => !paidSet.has(dc.toLowerCase())
  );

  if (unpaidDcNotes.length === 0) {
    return { unpaidItems: [], dcNotesPaid };
  }

  const unpaidSet = new Set(unpaidDcNotes.map((dc) => dc.toLowerCase()));
  const unpaidItems = soaList.filter((soaItem) =>
    unpaidSet.has(soaItem.debitAndCreditNoteNo.toLowerCase())
  );

  return { unpaidItems, dcNotesPaid };
};
```

Replace `createAndSendReminder` — allocates number from counter BEFORE doc generation (PDF needs the number), but records letter with `status: "sent"` only AFTER email succeeds. Uses a two-step process:

1. Allocate number + create `LetterRecord` with `status: "pending"`
2. On retry, detect the existing pending record and reuse the allocated number (avoid wasting sequence numbers on retries)
3. After email succeeds, update status to `"sent"`

```typescript
const createAndSendReminder = async (
  params: {
    ctx: ObjectContext;
    customer: IAccount;
    reminder: ISoaReminder;
    item: ISoaItem;
    unpaidItems: IStatementOfAccountModel[];
    latestLetter: LetterRecord | null;
    reminderCount: number;
    toEmail: string;
  }
): Promise<IGenerateReminderResult> => {
  const {
    ctx,
    customer,
    item,
    unpaidItems,
    latestLetter,
    reminderCount,
    toEmail,
  } = params;
  const dateNow = new Date(item.processingDate);
  const [year, month] = [dateNow.getFullYear(), dateNow.getMonth() + 1];
  const [timePeriod, officeId] = params.reminder.id.split(":");

  // ── Load existing letters to check for a pending (allocated) letter ──
  const existingLetters = (await ctx.get<LetterRecord[]>(
    stateKeys.letters(timePeriod, officeId)
  )) ?? [];

  // Check if we already allocated a letter for this reminder+type (idempotency)
  const existingPending = existingLetters.find(
    (l) => l.type === reminderCount.toString() && l.status === "pending"
  );

  const letterNo: string = existingPending?.letterNo ?? await (async () => {
    // ── Allocate letter number from counter object ──
    const seqNo = await ctx.objectClient(letterCounter, `${reminderCount}:${year}:${month}`).getNext();
    const paddedSeq = seqNo.toString().padStart(3, "0");
    const romanMonths = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    const no = `${paddedSeq}/FIN/SOA/RL${reminderCount}/${romanMonths[month - 1]}/${year}`;

    // Record letter with "pending" status
    const pendingLetter: LetterRecord = {
      type: reminderCount.toString(),
      letterNo: no,
      referenceLetterNo: latestLetter?.letterNo,
      sentDate: dateNow.toISOString(),
      status: "pending",
    };
    ctx.set(stateKeys.letters(timePeriod, officeId), [...existingLetters, pendingLetter]);
    return no;
  })();

  // ── Generate documents (PDF needs letterNo) ──
  const pdfFileName = reminderPdfName(reminderCount);
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  const { excelFileName } = await ctx.run(
    "generate-and-upload-documents",
    async () => {
      const result = await generateAndUploadDocuments({
        soaData: unpaidItems,
        customerData: customer,
        params: item,
        branchName,
        letterNo,
        latestLetter: latestLetter
          ? { id: params.reminder.id, ...latestLetter }
          : null,
        pdfFileName,
      });
      return { excelFileName: result.excelFile.fileName };
    }
  );

  // ── Send email ──
  const totalPremium = unpaidItems.reduce(
    (sum, s) => sum + (s.netPremiumIdr || 0),
    0
  );

  const emailResult = await ctx.run(
    "download-and-send-reminder-email",
    async () => {
      const { excelBuffer, pdfBuffer } = await downloadSoaFiles(
        customer.code,
        excelFileName,
        pdfFileName
      );
      return sendReminderEmail({
        customer,
        toEmail,
        reminderType: reminderCount.toString(),
        letterNo,
        previousLetterNo: latestLetter?.letterNo,
        previousLetterDate: latestLetter?.sentDate
          ? new Date(latestLetter.sentDate)
          : undefined,
        branch: branchName,
        totalPremium,
        excelFile: {
          fileName: excelFileName,
          bytes: excelBuffer,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        pdfFile: {
          fileName: pdfFileName,
          bytes: pdfBuffer,
          contentType: "application/pdf",
        },
        isReminder: item.processingType > 1,
        date: dateNow,
      });
    }
  );

  // ── Mark letter as sent (only after email succeeds) ──
  const allLetters = (await ctx.get<LetterRecord[]>(
    stateKeys.letters(timePeriod, officeId)
  )) ?? [];
  const updatedLetters = allLetters.map((l) =>
    l.letterNo === letterNo && l.status === "pending"
      ? { ...l, status: "sent" as const }
      : l
  );
  ctx.set(stateKeys.letters(timePeriod, officeId), updatedLetters);

  return { sent: emailResult, dcNotesPaid: [], letterNo, reason: "SENT" };
};
```

Replace the main `generateReminderLetter` function — replaces Oracle `getLatestLetter` with state read:

```typescript
export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = params;
  const processingDate = new Date(item.processingDate);

  // ── Read latest letter from state instead of Oracle ──
  const [timePeriod, officeId] = reminder.id.split(":");
  const letters = (await ctx.get<LetterRecord[]>(
    stateKeys.letters(timePeriod, officeId)
  )) ?? [];
  const latestLetter = letters.length > 0
    ? letters.reduce((latest, l) =>
        l.sentDate > latest.sentDate ? l : latest
      )
    : null;

  const reminderCount = validateReminderType(ctx, customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

  // ── Get emails (Oracle via ctx.run — stays) ──
  const branchCode = reminder.officeId || "ALL";
  let toEmail: string;
  if (isDevelopment()) {
    toEmail = customer.email || "dev-test@tob-ins.com";
  } else {
    const emails = await ctx.run("get-account-emails", () =>
      getAccountEmails(customer.code, branchCode)
    );
    toEmail = emails.join(",");
  }

  if (!toEmail) {
    ctx.console.log(`[Reminder] Skipping ${customer.code}: no email found`);
    return null;
  }

  // ── Get unpaid SOA data ──
  const unpaidData = await getUnpaidSoaData(ctx, customer, reminder, processingDate);
  if (!unpaidData) {
    return null;
  }

  if (unpaidData.unpaidItems.length === 0) {
    return {
      sent: false,
      dcNotesPaid: unpaidData.dcNotesPaid,
      letterNo: null,
      reason: "ALL_PAID",
    };
  }

  // ── Create and send ──
  const result = await createAndSendReminder({
    ctx,
    customer,
    reminder,
    item,
    unpaidItems: unpaidData.unpaidItems,
    latestLetter,
    reminderCount,
    toEmail,
  });

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};

// validateReminderType stays the same (pure function, no external calls)
function validateReminderType(
  ctx: { console: Console },
  customer: IAccount,
  item: ISoaItem,
  latestLetter: LetterRecord | null
): number | null {
  const previousType = latestLetter
    ? Number.parseInt(latestLetter.type, 10)
    : -1;
  const expectedType = item.processingType - 1;

  if (item.processingType === 1) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: type is SOA but has existing reminders`
    );
    return null;
  }

  if (previousType >= expectedType) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: already sent type ${previousType}`
    );
    return null;
  }

  if (expectedType > 3) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: expected type exceeds max (3)`
    );
    return null;
  }

  return expectedType;
}
```

**Note on `generateLetterNumber`:** The letter number generation is now inlined in `createAndSendReminder` because it needs `ctx` to call the counter object. The old `letter-number.generator.ts` is kept for the new SOA path (`process-branches.ts`) which doesn't use the counter yet — see Task 4g for how that's handled.

#### Task 4f: Refactor process-branches.ts (update Context → ObjectContext)

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/services/process-branches.ts`
- Modify: `apps/soa-finance/src/modules/soa/services/new-soa.ts`

Update function signatures to accept `ObjectContext` instead of `Context`:

In `process-branches.ts`:
- Change `import type { Context }` → `import type { ObjectContext }`
- Change parameter types to `ObjectContext`
- The `getAllBranches()` call stays in `ctx.run()` (reference data, unchanged)

In `new-soa.ts`:
- Change `import type { Context }` → `import type { ObjectContext }`
- Change parameter types to `ObjectContext`
- Everything else stays the same (no direct Oracle calls in this file)

#### Task 4g: Handle new SOA path letter number generation

For the new SOA path (`process-branches.ts` → `generateSoaDocuments`), letter numbers are generated via `generateLetterNumber(type, date)`. This path does NOT need the counter object because new SOA letters use a per-customer sequence scoped within the customer's state.

Add a simple per-customer counter to the SoaCustomer object (or keep the old `letter-number.generator.ts` but point it at state instead of Oracle). Since new SOA letters are always `type=1` (SOA), and each customer gets at most one per period, we can:

```typescript
// Inside SoaCustomer, or as a helper on ObjectContext:
async function getSoaLetterSequence(ctx: ObjectContext): Promise<number> {
  const count = (await ctx.get<number>("soaLetterCount")) ?? 0;
  ctx.set("soaLetterCount", count + 1);
  return count + 1;
}
```

Update the new SOA document generation path to use this instead of `generateLetterNumber`.

---

### Task 5: Update BatchWorkflow to Call SoaCustomer

**Files:**
- Modify: `apps/soa-finance/src/modules/soa/workflows/batch-workflow.ts`

**Step 5.1: Change import and client call**

Replace the `soaService` import and `ctx.serviceClient` call with `soaCustomer` and `ctx.objectClient`:

```typescript
// Change import:
// Before:
// import { type SoaService, soaService } from "./soa-workflow";
// After:
import { soaCustomer } from "../objects/soa-customer";

// Change the client call (inside startAccountProcessing):
// Before:
// const workerPromise = ctx
//   .serviceClient<SoaService>(soaService)
//   .process({ ... }, rpc.opts({ idempotencyKey }))
//   .map(...)
// After:
const workerPromise = ctx
  .objectClient(soaCustomer, accountId)
  .process({
    customerId: accountId,
    timePeriod: processingDates.timePeriod,
    processingDate: processingDates.processingDate,
    classOfBusiness: soaOptions.classOfBusiness,
    branch: soaOptions.branch,
    toDate: processingDates.toDate,
    processingType: soaProcessingType,
  }, rpc.opts({ idempotencyKey }))
  .map((_value, failure): WorkerResult => {
    if (failure) {
      return { accountId, failed: true, error: failure.message };
    }
    return { accountId, failed: false };
  });
```

**Step 5.2: Remove unused import**

Remove the `soaService` import `import { type SoaService, soaService } from "./soa-workflow"`.

**Step 5.3: Verify compilation**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No type errors

---

### Task 6: Register New Objects in App Entry Points

**Files:**
- Modify: `apps/soa-finance/src/app.lambda.ts`
- Modify: `apps/soa-finance/src/app.local.ts`

**Step 6.1: Update app.lambda.ts**

```typescript
import { createEndpointHandler } from "@restatedev/restate-sdk/lambda";
import { initOracleClient } from "./infrastructure/database/database.js";
import { batchWorkflow } from "./modules/soa/workflows/batch-workflow.js";
import { soaService } from "./modules/soa/workflows/soa-workflow.js";
import { SoaScheduler } from "./pipeline/scheduler.js";
import { soaCustomer } from "./modules/soa/objects/soa-customer.js";
import { letterCounter } from "./modules/soa/objects/letter-counter.js";

initOracleClient();

export const handler = createEndpointHandler({
  services: [soaService, batchWorkflow, SoaScheduler, soaCustomer, letterCounter],
});
```

Note: `soaService` is kept for backward compatibility during the transition period. Old in-flight invocations to `SoaService` will still resolve.

**Step 6.2: Update app.local.ts**

Add the same two imports and add `soaCustomer, letterCounter` to the services array:

```typescript
import { soaCustomer } from "./modules/soa/objects/soa-customer.js";
import { letterCounter } from "./modules/soa/objects/letter-counter.js";

// In the services array:
const services = [soaService, batchWorkflow, SoaScheduler, soaCustomer, letterCounter];
```

**Step 6.3: Verify compilation**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No type errors

---

### Task 7: Deprecate Old SoaService (Post-Cutover)

⚠️ **Cutover ordering is critical.** The old `SoaService` and its Oracle query dependencies must NOT be removed until all in-flight invocations are drained.

**Cutover sequence:**
1. ✅ Deploy new `SoaCustomer` + `LetterCounter` objects (Task 6 — both registered alongside old services)
2. ✅ Backfill existing Oracle data into Restate state (Task 8)
3. ✅ Switch `BatchWorkflow` to call `SoaCustomer` instead of `SoaService` (Task 5)
4. 🔄 **Wait** for all old `SoaService` invocations to complete
5. 🔄 Only then remove `SoaService` registration + delete Oracle query files

**This task (step 5) happens AFTER the rest of the plan.**

**Files:**
- Delete (later): `apps/soa-finance/src/infrastructure/database/queries/letter-query.ts`
- Delete (later): `apps/soa-finance/src/infrastructure/database/queries/reminder-query.ts`
- Delete (later): `apps/soa-finance/src/modules/soa/workflows/soa-workflow.ts`
- Delete (later): `apps/soa-finance/src/modules/document-generation/letter-number.generator.ts`
- Modify (later): `apps/soa-finance/src/infrastructure/database/queries/index.ts`

**Step 7.1 (Post-cutover): Verify no remaining imports**

Before deleting, grep for remaining imports:

```bash
grep -r "letter-query\|reminder-query\|soa-workflow\|letter-number.generator" apps/soa-finance/src/
```

Expected: Only the `index.ts` re-export lines and old service references. If the new code no longer imports these, proceed.

**Step 7.2 (Post-cutover): Remove files and update index.ts**

Delete: `letter-query.ts`, `reminder-query.ts`, `soa-workflow.ts`, `letter-number.generator.ts`
Update `queries/index.ts`:

```typescript
export * from "./branch-query";
export * from "./customer-query";
```

Remove `soaService` and `letter-number.generator` imports from `app.lambda.ts` / `app.local.ts`.

**Step 7.3 (Post-cutover): Verify compilation**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No type errors

---

### Task 8: Backfill Existing Oracle Data into Restate State

**Files:**
- Create: `apps/soa-finance/scripts/backfill-restate-state.ts`

This script reads existing Oracle data and calls the `SoaCustomer.backfill` handler for each customer. Also initializes the `LetterCounter` from existing letter data.

**Step 8.1: Create backfill script**

Create: `apps/soa-finance/scripts/backfill-restate-state.ts`

```typescript
/**
 * Backfill script: Migrate existing Oracle SOA_REMINDER_* data
 * into Restate Virtual Object K/V state.
 *
 * Usage: bun run scripts/backfill-restate-state.ts
 *
 * This script:
 * 1. Reads all reminders, details, and letters from Oracle
 * 2. Groups by customer code; translates Oracle UUIDs to composite keys
 * 3. Calls SoaCustomer.backfill handler for each customer
 * 4. Initializes LetterCounter from max letter sequence per type/year/month
 *
 * Safe to run multiple times (idempotent — backfill handler merges state).
 */

import { getOracleClient, closeConnections } from "../src/infrastructure/database/database.js";

const RESTATE_INGRESS = process.env.RESTATE_INGRESS ?? "http://localhost:8080";

interface OracleReminder {
  id: string; // RAWTOHEX(ID) — UUID
  cmCode: string;
  timePeriod: string;
  officeId: string;
}

interface OracleDetail {
  dcNoteId: string;
  isPaid: string; // "Y" or "N"
  reminderId: string; // FK to SOA_REMINDER.ID
}

interface OracleLetter {
  type: string;
  letterNo: string;
  sentDate: string; // ISO from Oracle DATE
  reminderId: string; // FK to SOA_REMINDER.ID
}

async function main() {
  const oracle = getOracleClient();

  // 1. Fetch all reminders
  const reminders: OracleReminder[] = (await oracle.executeQuery(
    `SELECT RAWTOHEX(ID) as "id", CM_CODE as "cmCode", TIME_PERIOD as "timePeriod", NVL(OFFICE_ID, 'ALL') as "officeId" FROM SOA_REMINDER`
  )).rows as OracleReminder[];

  // Map Oracle UUID → composite key {timePeriod}:{officeId}
  const uuidToComposite = new Map<string, string>();
  for (const r of reminders) {
    uuidToComposite.set(r.id, `${r.timePeriod}:${r.officeId}`);
  }

  // 2. Group by customer code
  const byCustomer = new Map<string, {
    headers: Array<{ timePeriod: string; officeId: string; createdAt: string }>;
    details: Record<string, Array<{ dcNoteId: string; isPaid: boolean }>>;
    letters: Record<string, Array<{ type: string; letterNo: string; sentDate: string }>>;
    dcNoteIndex: Record<string, string>;
  }>();

  for (const r of reminders) {
    if (!byCustomer.has(r.cmCode)) {
      byCustomer.set(r.cmCode, {
        headers: [],
        details: {},
        letters: {},
        dcNoteIndex: {},
      });
    }
    const entry = byCustomer.get(r.cmCode)!;
    const compositeId = uuidToComposite.get(r.id)!;

    entry.headers.push({
      timePeriod: r.timePeriod,
      officeId: r.officeId,
      createdAt: new Date().toISOString(), // approximate
    });

    // Fetch details for this reminder
    const detailRows: OracleDetail[] = (await oracle.executeQuery(
      `SELECT DC_NOTE_ID as "dcNoteId", IS_PAID as "isPaid", RAWTOHEX(REMINDER_ID) as "reminderId" FROM SOA_REMINDER_DETAIL WHERE REMINDER_ID = hextoraw(:id)`,
      { id: r.id }
    )).rows as OracleDetail[];

    entry.details[compositeId] = detailRows.map((d) => ({
      dcNoteId: d.dcNoteId,
      isPaid: d.isPaid === "Y",
    }));

    // Add to dcNoteIndex
    for (const d of detailRows) {
      entry.dcNoteIndex[d.dcNoteId.toLowerCase()] = compositeId;
    }

    // Fetch letters for this reminder
    const letterRows: OracleLetter[] = (await oracle.executeQuery(
      `SELECT TYPE as "type", LETTER_NO as "letterNo", SENT_DATE as "sentDate", RAWTOHEX(REMINDER_ID) as "reminderId" FROM SOA_REMINDER_LETTER WHERE REMINDER_ID = hextoraw(:id) ORDER BY SENT_DATE`,
      { id: r.id }
    )).rows as OracleLetter[];

    entry.letters[compositeId] = letterRows.map((l) => ({
      type: l.type,
      letterNo: l.letterNo,
      sentDate: new Date(l.sentDate).toISOString(),
    }));
  }

  // 3. Call SoaCustomer.backfill for each customer
  let successCount = 0;
  let failCount = 0;

  for (const [cmCode, data] of byCustomer) {
    try {
      const response = await fetch(
        `${RESTATE_INGRESS}/SoaCustomer/${encodeURIComponent(cmCode)}/backfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!response.ok) {
        console.error(`[FAIL] ${cmCode}: HTTP ${response.status}`);
        failCount++;
      } else {
        console.log(`[OK] ${cmCode}: ${data.headers.length} reminders, ${Object.keys(data.dcNoteIndex).length} DC notes, ${Object.values(data.letters).flat().length} letters`);
        successCount++;
      }
    } catch (err) {
      console.error(`[FAIL] ${cmCode}: ${err}`);
      failCount++;
    }
  }

  // 4. Initialize LetterCounter from existing letter data
  // For each (type, year, month), set the counter to max(seqNo) from existing letters
  const letterSeqPattern = /^(\d+)\/FIN\/SOA\/RL\d+\/\w+\/(\d{4})$/;
  const counterMap = new Map<string, number>();

  for (const data of byCustomer.values()) {
    for (const letterList of Object.values(data.letters)) {
      for (const l of letterList) {
        const match = l.letterNo.match(letterSeqPattern);
        if (match) {
          const seqNo = Number.parseInt(match[1], 10);
          const year = match[2];
          const key = `${l.type}:${year}`; // counter key format: {type}:{year}:{month}
          // We approximate month from sentDate
          const sentMonth = new Date(l.sentDate).getMonth() + 1;
          const fullKey = `${l.type}:${year}:${sentMonth}`;
          if (!counterMap.has(fullKey) || seqNo > counterMap.get(fullKey)!) {
            counterMap.set(fullKey, seqNo);
          }
        }
      }
    }
  }

  for (const [key, maxSeq] of counterMap) {
    try {
      await fetch(
        `${RESTATE_INGRESS}/LetterCounter/${encodeURIComponent(key)}/backfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ counter: maxSeq }),
        }
      );
      console.log(`[Counter] ${key}: initialized to ${maxSeq}`);
    } catch (err) {
      console.error(`[Counter] ${key}: failed - ${err}`);
    }
  }

  console.log(`\nDone: ${successCount} succeeded, ${failCount} failed`);
  await closeConnections();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

**Step 8.2: Add backfill handler to LetterCounter**

Add to `apps/soa-finance/src/modules/soa/objects/letter-counter.ts`:

```typescript
    /**
     * Initialize counter from backfill data (max existing sequence number).
     * Only sets if the new value is higher than the current counter.
     */
    backfill: async (ctx: restate.ObjectContext, data: { counter: number }) => {
      const current = (await ctx.get<number>("counter")) ?? 0;
      if (data.counter > current) {
        ctx.set("counter", data.counter);
      }
    },
```

**Step 8.3: Verify compilation**

Run: `bun run --filter @restate-tob/soa-finance typecheck`
Expected: No type errors

---

## Oracle Review

> To be completed after the plan is written. The plan reviewer (oracle agent) will evaluate for completeness, correctness, and potential issues before execution begins.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-04-soa-migrate-oracle-to-restate.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, and use parallel execution for independent tasks (Tasks 1+2 are independent, Tasks 6+7 are independent)

**2. Inline Execution** — Execute tasks in this session, one checkpointed batch at a time

Which approach?



# SOA Finance Component Simplification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) with dispatching-parallel-agents for independent tasks to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify 4 complexity hotspots in the SOA Finance service to improve readability and maintainability.

**Architecture:** Flatten branch processing, consolidate email sending, reduce parameter threading in reminder generation, and extract shared DC note parsing logic.

**Tech Stack:** TypeScript, Restate SDK, Bun

**Execution Order:** Tasks must run sequentially: 1 → 2 → 3 → 4. Tasks 2, 3, 4 share files and cannot be parallelized.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/utils/dc-note.ts` | Shared DC note parsing |
| Modify | `src/modules/payment/unpaid-data.ts` | Use DC note helper |
| Modify | `src/modules/payment/reconcile-payment.ts` | Use DC note helper |
| Modify | `src/modules/reminder/create.ts` | Use DC note helper |
| Create | `src/modules/email/send-soa-email.ts` | Unified email sender |
| Delete | `src/modules/email/send-soa.ts` | Merged into send-soa-email.ts |
| Delete | `src/modules/email/send-reminder.ts` | Merged into send-soa-email.ts |
| Delete | `src/modules/email/send-with-attachments.ts` | Merged into send-soa-email.ts |
| Modify | `src/modules/email/index.ts` | Update exports |
| Modify | `src/modules/reminder/generate-reminder-letter.ts` | Introduce ReminderContext |
| Modify | `src/modules/reminder/process-reminder.ts` | Update call site |
| Modify | `src/modules/soa/services/process-branches.ts` | Flatten 3 code paths into 1 |

---

### Task 1: Extract DC Note Parsing Helper

**Files:**
- Create: `src/utils/dc-note.ts`
- Modify: `src/modules/payment/unpaid-data.ts`
- Modify: `src/modules/payment/reconcile-payment.ts`
- Modify: `src/modules/reminder/create.ts`

- [ ] **Step 1: Create DC note parsing utility**

Create: `src/utils/dc-note.ts`

```typescript
/**
 * Parses a comma-separated DC note string into trimmed, non-empty IDs.
 * Returns lowercase IDs for case-insensitive comparison.
 */
export function parseDcNoteIds(dcNote: string): string[] {
  return (dcNote || "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
}

/**
 * Checks if all DC note IDs in a comma-separated string are present in the given set.
 */
export function areAllDcNotesPaid(
  dcNote: string,
  paidSet: Set<string>
): boolean {
  const noteIds = parseDcNoteIds(dcNote);
  return noteIds.length > 0 && noteIds.every((id) => paidSet.has(id));
}
```

- [ ] **Step 2: Update unpaid-data.ts to use the helper**

Edit `src/modules/payment/unpaid-data.ts` — replace the duplicate parsing logic:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import type { Account } from "../../types/customer.type.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";
import { areAllDcNotesPaid } from "../../utils/dc-note.js";
import { getStagingSoaData } from "../data-access/staging-reader.js";
import type { SoaReminder } from "../reminder/types.js";
import type { ReminderDetail } from "../soa/objects/state.js";
import { stateKeys } from "../soa/objects/state.js";
import { reconcilePayment } from "./reconcile-payment.js";

export async function getUnpaidSoaData(
  ctx: ObjectContext,
  customer: Account,
  reminder: SoaReminder
): Promise<{
  unpaidItems: StatementOfAccountModel[];
  dcNotesPaid: string[];
} | null> {
  const branchCode = reminder.officeId || SENTINEL_ALL;

  const soaList = await ctx.run("read-soa-staging", () =>
    getStagingSoaData(customer.code, branchCode)
  );

  if (soaList.length === 0) {
    return null;
  }

  const currentDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);

  const [timePeriod, officeId] = reminder.id.split(":");
  const details = await ctx.get<Record<string, ReminderDetail>>(
    stateKeys.details(timePeriod, officeId)
  );

  const { paidDcNoteIds, updatedDetails, bulkPaymentSkipped } =
    reconcilePayment(details, currentDcNotes);

  if (bulkPaymentSkipped) {
    const detailsCount = Object.keys(details ?? {}).length;
    ctx.console.log(
      `[Payment] Skipping bulk payment: ${detailsCount}/${detailsCount} would be marked paid — possible data issue`
    );
  }

  if (Object.keys(updatedDetails).length > 0) {
    ctx.set(stateKeys.details(timePeriod, officeId), updatedDetails);
  }

  const dcNotesPaid = paidDcNoteIds;
  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));

  // Filter unpaid items directly using the helper — handles comma-separated DC notes correctly
  const unpaidItems = soaList.filter(
    (soaItem) => !areAllDcNotesPaid(soaItem.debitAndCreditNoteNo, paidSet)
  );

  if (unpaidItems.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: all ${dcNotesPaid.length} DC notes paid`
    );
    return { unpaidItems: [], dcNotesPaid };
  }

  ctx.console.log(
    `[Reminder] DC notes for ${customer.code}: ${dcNotesPaid.length} paid, ${unpaidItems.length} items unpaid`
  );

  return { unpaidItems, dcNotesPaid };
}
```

- [ ] **Step 3: Update reconcile-payment.ts to use the helper**

Edit `src/modules/payment/reconcile-payment.ts`:

```typescript
import type { ReminderDetail } from "../soa/objects/state.js";
import { parseDcNoteIds } from "../../utils/dc-note.js";

const BULK_PAYMENT_MIN_COUNT = 5;
const BULK_PAYMENT_RATIO_THRESHOLD = 0.8;

export const reconcilePayment = (
  details: Record<string, ReminderDetail> | null,
  currentDcNotes: string[]
): {
  paidDcNoteIds: string[];
  updatedDetails: Record<string, ReminderDetail>;
  bulkPaymentSkipped: boolean;
} => {
  if (!details) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: false };
  }

  const currentDcNotesSet = new Set(
    currentDcNotes.flatMap((dc) => parseDcNoteIds(dc))
  );

  const paidDcNotes = Object.values(details).filter(
    (detail) =>
      !(detail.isPaid || currentDcNotesSet.has(detail.dcNoteId.toLowerCase()))
  );

  if (paidDcNotes.length === 0) {
    return { paidDcNoteIds: [], updatedDetails: {}, bulkPaymentSkipped: false };
  }

  // Safety: don't mark most reminders as paid at once (likely data issue)
  const totalDetails = Object.keys(details).length;

  if (totalDetails > BULK_PAYMENT_MIN_COUNT) {
    const paidRatio = paidDcNotes.length / totalDetails;
    if (paidRatio >= BULK_PAYMENT_RATIO_THRESHOLD) {
      return {
        paidDcNoteIds: [],
        updatedDetails: {},
        bulkPaymentSkipped: true,
      };
    }
  }

  const updatedDetails = { ...details };
  for (const paid of paidDcNotes) {
    updatedDetails[paid.dcNoteId] = { ...paid, isPaid: true };
  }

  return {
    paidDcNoteIds: paidDcNotes.map((d) => d.dcNoteId),
    updatedDetails,
    bulkPaymentSkipped: false,
  };
};
```

- [ ] **Step 4: Update create.ts to use the helper**

Edit `src/modules/reminder/create.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import type { Account } from "../../types/customer.type.js";
import type { StatementOfAccountModel } from "../../types/soa.type.js";
import { parseDcNoteIds } from "../../utils/dc-note.js";
import type { ReminderDetail, ReminderHeader } from "../soa/objects/state.js";
import { stateKeys } from "../soa/objects/state.js";

export interface CreateReminderParams {
  branchCode: string;
  ctx: ObjectContext;
  customer: Account;
  processingDate: string;
  soaList: StatementOfAccountModel[];
  timePeriod: string;
}

export const createReminder = async (
  params: CreateReminderParams
): Promise<string> => {
  const { customer, timePeriod, branchCode, soaList, ctx } = params;
  ctx.console.log(
    `[Reminder] Creating SOA reminder for ${customer.code}, branch: ${branchCode}`
  );

  const reminderId = `${timePeriod}:${branchCode}`;

  const header: ReminderHeader = {
    customerCode: customer.code,
    timePeriod,
    officeId: branchCode,
    createdAt: params.processingDate,
  };
  ctx.set(stateKeys.header(timePeriod, branchCode), header);

  const detailsMap: Record<string, ReminderDetail> = {};
  const newIndexEntries: Record<string, string> = {};

  for (const soa of soaList) {
    const dcNoteIds = parseDcNoteIds(soa.debitAndCreditNoteNo);
    for (const dcNoteId of dcNoteIds) {
      detailsMap[dcNoteId] = { dcNoteId, reminderId, isPaid: false };
      newIndexEntries[dcNoteId] = reminderId;
    }
  }

  const existingIndex =
    (await ctx.get<Record<string, string>>(
      stateKeys.dcNoteIndex(timePeriod)
    )) ?? {};
  const mergedIndex = { ...existingIndex, ...newIndexEntries };

  ctx.set(stateKeys.details(timePeriod, branchCode), detailsMap);
  ctx.set(stateKeys.dcNoteIndex(timePeriod), mergedIndex);

  ctx.console.log(
    `[Reminder] Created reminder ${reminderId} with ${soaList.length} details for ${customer.code}`
  );

  return reminderId;
};
```

- [ ] **Step 5: Verify typecheck and lint pass**

Run: `bun run typecheck` (workdir: `apps/soa-finance`)
Expected: No errors

Run: `bun run lint` (workdir: `apps/soa-finance`)
Expected: No errors (or only pre-existing warnings)

---

### Task 2: Consolidate Email Sending

**Files:**
- Create: `src/modules/email/send-soa-email.ts`
- Delete: `src/modules/email/send-soa.ts`
- Delete: `src/modules/email/send-reminder.ts`
- Delete: `src/modules/email/send-with-attachments.ts`
- Modify: `src/modules/email/index.ts`

**Note:** Do NOT modify `process-branches.ts` or `generate-reminder-letter.ts` in this task — Tasks 3 and 4 handle those imports.

- [ ] **Step 1: Create unified email sender**

Create: `src/modules/email/send-soa-email.ts`

```typescript
import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import { sendEmail } from "../../infrastructure/email/index.js";
import type { SendEmailResult } from "../../infrastructure/email/types.js";
import type { Account } from "../../types/customer.type.js";
import type { FileData } from "../../types/soa.type.js";
import { formatDateDDMMYYYY } from "../../utils/formatter/date.formatter.js";
import {
  buildEmailAttachments,
  getCcRecipients,
  resolveRecipientEmail,
} from "./attachments.js";
import { generateReminderEmailHtml, getReminderEmailSubject } from "./templates/reminder.js";
import { generateSoaEmailHtml } from "./templates/soa.js";

export interface SendSoaEmailParams {
  branch?: string;
  customerData: Account;
  date: Date;
  excelFile: FileData;
  isReminder?: boolean;
  letterNo?: string;
  pdfFile: FileData;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType?: string;
  /** Override recipient email. If not provided, uses customerData.email. */
  toEmail?: string;
  totalPremium?: number;
}

/**
 * Unified email sender for both SOA and reminder emails.
 * Replaces send-soa.ts, send-reminder.ts, and send-with-attachments.ts.
 */
export async function sendSoaEmail(
  params: SendSoaEmailParams
): Promise<SendEmailResult> {
  const {
    customerData,
    date,
    isReminder,
    reminderType,
    letterNo,
    previousLetterNo,
    previousLetterDate,
    branch,
    toEmail,
    totalPremium,
    excelFile,
    pdfFile,
  } = params;

  const customerEmail = toEmail || customerData.email || "";

  let htmlContent: string;
  let subject: string;

  if (isReminder) {
    const emailData = {
      customerName: customerData.fullName,
      asAtDate: date,
      virtualAccount: customerData.virtualAccount || "-",
      letterNo: letterNo || "",
      previousLetterNo,
      previousLetterDate,
      branch,
      totalPremium,
    };

    const templateName = "TemplateReminderLetterSOA";
    htmlContent = await generateReminderEmailHtml(
      reminderType || "1",
      emailData,
      templateName
    );
    subject = getReminderEmailSubject(reminderType || "1", customerData.fullName);
  } else {
    htmlContent = await generateSoaEmailHtml({
      customerName: customerData.fullName,
      virtualAccount: customerData.virtualAccount || "-",
      asAtDate: date,
    });
    subject = `SOA OUTSTANDING ${customerData.fullName} as ${formatDateDDMMYYYY(date)}`;
  }

  const recipientEmail = isDevelopment()
    ? getTestEmailRecipient()
    : resolveRecipientEmail(customerEmail);

  const recipients = recipientEmail.split(",").map((r) => r.trim()).filter((r) => r.length > 0);

  if (recipients.length === 0) {
    throw new Error(`No recipients for ${customerData.code}`);
  }

  const sent = await sendEmail({
    to: recipients,
    cc: isDevelopment()
      ? [getTestEmailRecipient()]
      : getCcRecipients(customerData.actingCode),
    subject,
    body: htmlContent,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  });

  if (!sent) {
    throw new Error(
      `Email failed for ${customerData.code} to: ${recipientEmail}`
    );
  }

  return { sent: true };
}
```

- [ ] **Step 2: Update email module index**

Edit `src/modules/email/index.ts`:

```typescript
export { sendSoaEmail, type SendSoaEmailParams } from "./send-soa-email.js";
export { buildEmailAttachments, getCcRecipients, resolveRecipientEmail } from "./attachments.js";
```

- [ ] **Step 3: Delete old files**

Delete:
- `src/modules/email/send-soa.ts`
- `src/modules/email/send-reminder.ts`
- `src/modules/email/send-with-attachments.ts`

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck` (workdir: `apps/soa-finance`)
Expected: Errors in `process-branches.ts` and `generate-reminder-letter.ts` — this is expected; Tasks 3 and 4 will fix them.

---

### Task 3: Introduce ReminderContext and Update Reminder Module

**Files:**
- Modify: `src/modules/reminder/generate-reminder-letter.ts`
- Modify: `src/modules/reminder/process-reminder.ts`

**Depends on:** Task 2 (sendSoaEmail export must exist)

- [ ] **Step 1: Refactor generate-reminder-letter.ts with ReminderContext**

Edit `src/modules/reminder/generate-reminder-letter.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { isDevelopment } from "../../constants/environment.js";
import { getAccountEmails } from "../../infrastructure/database/queries/customer-query.js";
import type { Account } from "../../types/customer.type.js";
import type { SoaItem, StatementOfAccountModel } from "../../types/soa.type.js";
import { reminderPdfName } from "../../utils/formatter/naming.formatter.js";
import { sendSoaEmail } from "../email/index.js";
import { generateAndUploadDocuments } from "../document-generation/index.js";
import { getUnpaidSoaData } from "../payment/unpaid-data.js";
import {
  assignLetterRecord,
  getLatestSentLetter,
  getReminderLetters,
  type LatestLetter,
  type StoredLetterRecord,
  updateLetterStatus,
} from "./letter-state.js";
import type { GenerateReminderResult, SoaReminder } from "./types.js";

const DEV_TEST_EMAIL = process.env.SOA_DEV_TEST_EMAIL || "dev-test@tob-ins.com";

/**
 * Bundles shared parameters for reminder processing.
 * Reduces parameter threading through multiple function layers.
 */
interface ReminderContext {
  ctx: ObjectContext;
  customer: Account;
  item: SoaItem;
  reminder: SoaReminder;
}

const validateReminderType = (
  ctx: ObjectContext,
  customer: Account,
  item: SoaItem,
  latestLetter: LatestLetter
): number | null => {
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

  const reminderCount = expectedType;
  ctx.console.log(
    `[Reminder] Processing type ${reminderCount} for ${customer.code}`
  );
  return reminderCount;
};

const generateUploadAndSendReminder = async (
  reminderCtx: ReminderContext,
  params: {
    unpaidItems: StatementOfAccountModel[];
    latestLetter: LatestLetter;
    letterNo: string;
    reminderCount: number;
    toEmail: string;
    type: string;
    branchName: string;
  }
): Promise<void> => {
  const { ctx, customer, item } = reminderCtx;
  const { unpaidItems, latestLetter, letterNo, reminderCount, toEmail, type, branchName } = params;

  const dateNow = new Date(item.processingDate);
  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
    0
  );
  const pdfFileName = reminderPdfName(reminderCount);

  await ctx.run("generate-upload-send-reminder", async () => {
    const files = await generateAndUploadDocuments({
      soaData: unpaidItems,
      customerData: customer,
      params: item,
      branchName,
      letterNo,
      latestLetter,
      pdfFileName,
    });

    await sendSoaEmail({
      customerData: customer,
      date: dateNow,
      isReminder: true,
      reminderType: type,
      letterNo,
      previousLetterNo: latestLetter?.letterNo,
      previousLetterDate: latestLetter?.sentDate,
      branch: branchName,
      toEmail,
      totalPremium,
      excelFile: files.excelFile,
      pdfFile: files.pdfFile,
    });
  });
};

const createAndSendReminder = async (
  reminderCtx: ReminderContext,
  params: {
    unpaidItems: StatementOfAccountModel[];
    latestLetter: LatestLetter;
    letters: StoredLetterRecord[];
    reminderCount: number;
    toEmail: string;
  }
): Promise<GenerateReminderResult> => {
  const { ctx, customer, reminder, item } = reminderCtx;
  const { unpaidItems, latestLetter, letters, reminderCount, toEmail } = params;

  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  // Phase 1: Assign letter record
  const pendingRecord = await assignLetterRecord({
    ctx,
    reminder,
    type,
    dateNow,
    latestLetter,
    letters,
  });

  try {
    await generateUploadAndSendReminder(reminderCtx, {
      unpaidItems,
      latestLetter,
      letterNo: pendingRecord.letterNo,
      reminderCount,
      toEmail,
      type,
      branchName,
    });
  } catch (error: unknown) {
    await updateLetterStatus(ctx, reminder, pendingRecord, "failed");
    throw error;
  }

  await updateLetterStatus(ctx, reminder, pendingRecord, "sent");

  return {
    sent: true,
    dcNotesPaid: [],
    letterNo: pendingRecord.letterNo,
    reason: "SENT",
  };
};

export const generateReminderLetter = async (
  reminderCtx: ReminderContext
): Promise<GenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = reminderCtx;
  const startTime = await ctx.date.now();

  const letters = await getReminderLetters(ctx, reminder);
  const latestLetter = getLatestSentLetter(letters);
  const reminderCount = validateReminderType(ctx, customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

  const branchCode = reminder.officeId || SENTINEL_ALL;

  let toEmail: string;
  if (isDevelopment()) {
    toEmail = customer.email || DEV_TEST_EMAIL;
  } else {
    const emails = await ctx.run("get-account-emails", () =>
      getAccountEmails(customer.code, branchCode)
    );
    toEmail = emails.join(",");
  }

  if (!toEmail) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no email addresses found`
    );
    return null;
  }

  const unpaidData = await getUnpaidSoaData(ctx, customer, reminder);
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

  const result = await createAndSendReminder(reminderCtx, {
    unpaidItems: unpaidData.unpaidItems,
    latestLetter,
    reminderCount,
    letters,
    toEmail,
  });

  const duration = (await ctx.date.now()) - startTime;
  ctx.console.log(
    { component: "Reminder", customer: customer.code, durationMs: duration },
    `Reminder completed in ${duration}ms`
  );

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};
```

- [ ] **Step 2: Update process-reminder.ts to pass ReminderContext**

Edit `src/modules/reminder/process-reminder.ts` — update the call site:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import type { Account } from "../../types/customer.type.js";
import { type SoaItem, SoaTypeLabels } from "../../types/soa.type.js";
import type { ReminderHeader } from "../soa/objects/state.js";
import { readDcNoteIndex, stateKeys } from "../soa/objects/state.js";
import { generateReminderLetter } from "./generate-reminder-letter.js";
import type { ProcessReminder } from "./types.js";

interface ProcessReminderParams {
  ctx: ObjectContext;
  customer: Account;
  item: SoaItem;
}

interface SoaReminder {
  customerCode: string;
  id: string;
  officeId: string;
  timePeriod: string;
}

export const processReminderLetter = async (
  params: ProcessReminderParams
): Promise<ProcessReminder> => {
  const { ctx, customer, item } = params;

  ctx.console.log(
    `[Reminder] Processing for ${customer.code}, type: ${
      SoaTypeLabels[item.processingType]
    }`
  );

  const dcNoteIndex = await readDcNoteIndex(ctx, item.timePeriod);

  if (Object.keys(dcNoteIndex).length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no previous reminder records`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const reminderIdsForPeriod = new Set(
    Object.values(dcNoteIndex).filter((id) =>
      id.startsWith(`${item.timePeriod}:`)
    )
  );

  if (reminderIdsForPeriod.size === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminders for period ${item.timePeriod}`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const reminders: SoaReminder[] = [];
  for (const reminderId of reminderIdsForPeriod) {
    const [officeId] = reminderId.split(":").slice(1);
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

  if (reminders.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no reminder headers found`
    );
    return { processed: false, remindersSent: 0, dcNotesPaid: [] };
  }

  const allDcNotesPaid: string[] = [];
  let remindersSent = 0;

  for (const reminder of reminders) {
    const result = await generateReminderLetter({
      ctx,
      customer,
      item,
      reminder,
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

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck` (workdir: `apps/soa-finance`)
Expected: Error in `process-branches.ts` only (Task 4 will fix it)

---

### Task 4: Flatten Branch Processing

**Files:**
- Modify: `src/modules/soa/services/process-branches.ts`

**Depends on:** Task 2 (sendSoaEmail export must exist)

**Key constraint:** NEVER call Restate context methods inside `ctx.run()` callbacks — causes deadlock on Lambda. Use `ctx.run()` only around leaf side-effects (DB reads, doc generation, email send). Use `try/catch` for branch-level error isolation.

- [ ] **Step 1: Refactor to single processing path**

Edit `src/modules/soa/services/process-branches.ts`:

```typescript
import type { ObjectContext } from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../../constants/environment.js";
import { getAllBranches } from "../../../infrastructure/database/queries/branch-query.js";
import type { Branch } from "../../../infrastructure/database/types.js";
import type { Account } from "../../../types/customer.type.js";
import type {
  SoaItem,
  StatementOfAccountModel,
} from "../../../types/soa.type.js";
import { letterSoaPdfName } from "../../../utils/formatter/naming.formatter.js";
import { getStagingSoaData } from "../../data-access/staging-reader.js";
import { generateAndUploadDocuments } from "../../document-generation/index.js";
import { sendSoaEmail } from "../../email/index.js";
import { createReminder } from "../../reminder/index.js";
import { filterAgingData } from "../fetch-soa-data.js";
import { multiBranchCodes } from "../types.js";

export interface ProcessSoaParams {
  ctx: ObjectContext;
  customerData: Account;
  params: SoaItem;
}

interface BranchResult {
  hasDocuments: boolean;
}

interface BranchProcessResult {
  branch: Branch;
  hasDocuments: boolean;
  soaData: StatementOfAccountModel[] | null;
}

/**
 * Process a single branch: read staging, filter aging, generate docs, send email.
 * Each external call is wrapped in its own ctx.run() — no nesting.
 * Returns null on non-terminal failures (branch error isolation).
 */
async function processSingleBranch(
  params: ProcessSoaParams,
  branch: Branch
): Promise<BranchProcessResult | null> {
  const { ctx, customerData, params: soaParams } = params;

  // Step 1: Read staging data (external call)
  let rawSoaList: StatementOfAccountModel[] | null;
  try {
    rawSoaList = await ctx.run<StatementOfAccountModel[] | null>(
      `read-staging-${branch.officeCode}`,
      async () => await getStagingSoaData(customerData.code, branch.officeCode)
    );
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed staging read for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
  }

  if (!rawSoaList || rawSoaList.length === 0) {
    ctx.console.log(`[Branch] No SOA data for ${branch.officeCode}`);
    return { branch, hasDocuments: false, soaData: null };
  }

  ctx.console.log(
    `Processing branch ${branch.officeCode} for customer ${customerData.code}`
  );

  // Pure logic — no ctx calls needed
  const soaData = filterAgingData(rawSoaList);
  if (!soaData) {
    ctx.console.log(`Skipping ${customerData.code}: No aging records found`);
    return { branch, hasDocuments: false, soaData: null };
  }

  const startTime = await ctx.date.now();
  const dateNow = new Date(soaParams.processingDate);

  ctx.console.log(
    `SOA generated for ${customerData.code} branch ${branch.officeCode}: ${soaData.length} records`
  );

  // Step 2: Generate + upload + send (external calls in one ctx.run)
  try {
    await ctx.run(`generate-upload-send-${branch.officeCode}`, async () => {
      const generated = await generateAndUploadDocuments({
        soaData,
        customerData,
        params: soaParams,
        branchName: branch.name,
        letterNo: "",
        latestLetter: null,
        pdfFileName: letterSoaPdfName(customerData.code),
      });

      await sendSoaEmail({
        customerData,
        date: dateNow,
        isReminder: false,
        excelFile: generated.excelFile,
        pdfFile: generated.pdfFile,
      });
    });
  } catch (error: unknown) {
    if (error instanceof TerminalError) {
      throw error;
    }
    ctx.console.log(
      `[Branch] Failed generate/send for ${branch.officeCode}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
  }

  const duration = (await ctx.date.now()) - startTime;
  ctx.console.log(
    { component: "Branch", branch: branch.officeCode, durationMs: duration },
    `Branch ${branch.officeCode} completed in ${duration}ms`
  );

  return { branch, hasDocuments: true, soaData };
}

/**
 * Process SOA for a customer across one or more branches.
 * Uses try/catch for error isolation — one branch failure doesn't kill the customer.
 */
export async function processBranchSoa(
  params: ProcessSoaParams
): Promise<BranchResult> {
  const { ctx, customerData } = params;
  const isMultiBranch =
    !isDevelopment() && multiBranchCodes.includes(customerData.actingCode);

  const branches: Branch[] = isMultiBranch
    ? await ctx.run("get-branches", async () => await getAllBranches())
    : [{ officeCode: params.params.branch, name: params.params.branch }];

  if (isMultiBranch) {
    ctx.console.log(`Processing ${branches.length} branches`);
  }

  // Process branches sequentially with error isolation via try/catch.
  // Each branch's external calls use their own ctx.run() — no nesting.
  const results: BranchProcessResult[] = [];

  for (const branch of branches) {
    const result = await processSingleBranch(params, branch);
    if (result) {
      results.push(result);
    }
  }

  // Create reminders for branches that generated documents
  for (const result of results) {
    if (result.hasDocuments && result.soaData) {
      await createReminder({
        customer: customerData,
        timePeriod: params.params.timePeriod,
        branchCode: result.branch.officeCode,
        processingDate: params.params.processingDate,
        soaList: result.soaData,
        ctx,
      });
    }
  }

  return { hasDocuments: results.some((r) => r.hasDocuments) };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck` (workdir: `apps/soa-finance`)
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `bun run lint` (workdir: `apps/soa-finance`)
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 4: Run tests**

Run: `bun run test` (workdir: `apps/soa-finance`)
Expected: All tests pass

---

## Self-Review

- [x] **Spec coverage:** All 4 simplification targets covered
- [x] **Blocking issues fixed:**
  - Task 4 no longer nests `ctx.run()` — uses `try/catch` for isolation
  - Task dependencies clarified: 1 → 2 → 3 → 4
  - DC note parsing fixed: uses `areAllDcNotesPaid` directly for filtering
  - Unused import removed from Task 1
- [x] **Warning issues fixed:**
  - `toEmail` parameter added to `SendSoaEmailParams` and threaded through
  - `createReminder` included in DC note parsing extraction (Task 1 Step 4)
- [x] **Placeholder scan:** No TBDs, TODOs, or vague instructions
- [x] **Type consistency:** All interfaces and function signatures match across tasks

---

## Execution Handoff

Plan complete and reviewed. Execution must be sequential: Task 1 → 2 → 3 → 4.

**Recommended approach:** Subagent-driven — dispatch one subagent per task, verify between tasks.

Ready to execute?

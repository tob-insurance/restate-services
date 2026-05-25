import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { isDevelopment } from "../../constants/environment.js";
import { getAccountEmails } from "../../infrastructure/database/queries/customer-query.js";
import type { Account } from "../../types/customer.type.js";
import type { SoaItem, StatementOfAccountModel } from "../../types/soa.type.js";
import { reminderPdfName } from "../../utils/formatter/naming.formatter.js";
import { generateAndUploadDocuments } from "../document-generation";
import { sendWithAttachments } from "../email/send-with-attachments.js";
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

interface GenerateReminderLetterParams {
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

interface CreateAndSendReminderParams {
  ctx: ObjectContext;
  customer: Account;
  item: SoaItem;
  latestLetter: LatestLetter;
  letters: StoredLetterRecord[];
  reminder: SoaReminder;
  reminderCount: number;
  unpaidItems: StatementOfAccountModel[];
}

interface GenerateUploadSendReminderParams {
  branchName: string;
  ctx: ObjectContext;
  customer: Account;
  item: SoaItem;
  latestLetter: LatestLetter;
  letterNo: string;
  reminderCount: number;
  type: string;
  unpaidItems: StatementOfAccountModel[];
}

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
  });
};

const createAndSendReminder = async (
  params: CreateAndSendReminderParams
): Promise<GenerateReminderResult> => {
  const {
    ctx,
    customer,
    reminder,
    item,
    unpaidItems,
    latestLetter,
    reminderCount,
    letters,
  } = params;
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
    await generateUploadAndSendReminder({
      ctx,
      unpaidItems,
      customer,
      item,
      reminderCount,
      letterNo: pendingRecord.letterNo,
      latestLetter,
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
  params: GenerateReminderLetterParams
): Promise<GenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = params;

  const letters = await getReminderLetters(ctx, reminder);
  const latestLetter = getLatestSentLetter(letters);
  const reminderCount = validateReminderType(ctx, customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

  const branchCode = reminder.officeId || SENTINEL_ALL;

  let toEmail: string;
  if (isDevelopment()) {
    // Development-only fallback recipient when SOA_DEV_TEST_EMAIL is not set.
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

  const result = await createAndSendReminder({
    ctx,
    customer,
    reminder,
    item,
    unpaidItems: unpaidData.unpaidItems,
    latestLetter,
    reminderCount,
    letters,
  });

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};

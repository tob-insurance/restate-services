import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { isDevelopment } from "../../constants/environment.js";
import { getAccountEmails } from "../../infrastructure/database/queries/customer-query.js";
import type { Account } from "../../types/customer.type.js";
import type { SoaItem, StatementOfAccountModel } from "../../types/soa.type.js";
import { reminderPdfName } from "../../utils/formatter/naming.formatter.js";
import { generateAndUploadDocuments } from "../document-generation/index.js";
import { sendSoaEmail } from "../email/index.js";
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
  const {
    unpaidItems,
    latestLetter,
    letterNo,
    reminderCount,
    toEmail,
    type,
    branchName,
  } = params;

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
      reminderType: type as "1" | "2" | "3",
      letterNo,
      previousLetterNo: latestLetter?.letterNo,
      previousLetterDate: latestLetter?.sentDate,
      branch: branchName,
      toEmail,
      totalPremium,
      excelFileName: files.excelFileName,
      excelUrl: files.excelUrl,
      pdfFileName: files.pdfFileName,
      pdfUrl: files.pdfUrl,
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
  const { ctx, reminder, item } = reminderCtx;
  const { unpaidItems, latestLetter, letters, reminderCount, toEmail } = params;

  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

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

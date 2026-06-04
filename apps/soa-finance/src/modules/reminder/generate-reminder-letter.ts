import type { ObjectContext } from "@restatedev/restate-sdk";
import { SENTINEL_ALL } from "../../constants/constants.js";
import { isDevelopment } from "../../constants/environment.js";
import { getAccountEmails } from "../../infrastructure/database/queries/customer-query.js";
import type { Account } from "../../types/customer.type.js";
import type { SoaItem } from "../../types/soa.type.js";
import { reminderPdfName } from "../../utils/formatter/naming.formatter.js";
import { getStagingSoaData } from "../data-access/staging-reader.js";
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

const createAndSendReminder = async (
  reminderCtx: ReminderContext,
  params: {
    branchName: string;
    latestLetter: LatestLetter;
    letters: StoredLetterRecord[];
    reminderCount: number;
    toEmail: string;
  }
): Promise<GenerateReminderResult> => {
  const { ctx, customer, reminder, item } = reminderCtx;
  const { branchName, latestLetter, letters, reminderCount, toEmail } = params;

  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();

  const pendingRecord = await assignLetterRecord({
    ctx,
    reminder,
    type,
    dateNow,
    latestLetter,
    letters,
  });

  try {
    // Re-fetch unpaid data inside ctx.run() — large array never crosses boundary
    await ctx.run("generate-upload-send-reminder", async () => {
      const unpaidData = await getStagingSoaData(
        customer.code,
        reminder.officeId || SENTINEL_ALL
      );
      if (unpaidData.length === 0) {
        return;
      }

      const files = await generateAndUploadDocuments({
        soaData: unpaidData,
        customerData: customer,
        params: item,
        branchName,
        letterNo: pendingRecord.letterNo,
        latestLetter,
        pdfFileName: reminderPdfName(customer.code),
      });

      await sendSoaEmail({
        customerData: customer,
        date: dateNow,
        isReminder: true,
        reminderType: type as "1" | "2" | "3",
        letterNo: pendingRecord.letterNo,
        previousLetterNo: latestLetter?.letterNo,
        previousLetterDate: latestLetter?.sentDate,
        branch: branchName,
        toEmail,
        totalPremium: unpaidData.reduce(
          (sum, s) => sum + (s.netPremiumIdr || 0),
          0
        ),
        excelFileName: files.excelFileName,
        excelUrl: files.excelUrl,
        pdfFileName: files.pdfFileName,
        pdfUrl: files.pdfUrl,
      });
    });
  } catch (error: unknown) {
    await updateLetterStatus(ctx, reminder, pendingRecord, "failed");
    throw error;
  }

  await updateLetterStatus(ctx, reminder, pendingRecord, "sent");

  return {
    sent: true,
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

  if (unpaidData.unpaidCount === 0) {
    return {
      sent: false,
      letterNo: null,
      reason: "ALL_PAID",
    };
  }

  const result = await createAndSendReminder(reminderCtx, {
    branchName: unpaidData.branchName,
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

  return { ...result };
};

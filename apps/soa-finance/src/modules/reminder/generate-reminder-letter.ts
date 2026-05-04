import type { ObjectContext } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../constants";
import { downloadSoaFiles } from "../../infrastructure/azure";
import {
  getAccountEmails,
  getLatestLetter,
  insertReminderLetter,
} from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import type { IAccount, ISoaItem, IStatementOfAccountModel } from "../../types";
import { reminderPdfName } from "../../utils/formatter";
import {
  generateAndUploadDocuments,
  generateLetterNumber,
} from "../document-generation";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";
import type { IGenerateReminderResult, ISoaReminder } from "./types";

type GenerateReminderLetterParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
};

type LatestLetter = Awaited<ReturnType<typeof getLatestLetter>>;

const validateReminderType = (
  ctx: ObjectContext,
  customer: IAccount,
  item: ISoaItem,
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

const getUnpaidSoaData = async (
  ctx: ObjectContext,
  customer: IAccount,
  reminder: ISoaReminder,
  processingDate: Date
): Promise<{
  unpaidItems: IStatementOfAccountModel[];
  dcNotesPaid: string[];
} | null> => {
  const branchCode = reminder.officeId || "ALL";

  const soaList = await ctx.run("read-soa-parquet", () =>
    readSoaParquet(customer.code, branchCode, processingDate)
  );

  if (soaList.length === 0) {
    return null;
  }

  const currentParquetDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
  const dcNotesPaid = await ctx.run("reconcile-payment", () =>
    reconcilePayment(ctx, reminder.id, currentParquetDcNotes)
  );

  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));

  const unpaidDcNotes = currentParquetDcNotes.filter(
    (dc) => !paidSet.has(dc.toLowerCase())
  );

  if (unpaidDcNotes.length === 0) {
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: all ${dcNotesPaid.length} DC notes paid`
    );
    return { unpaidItems: [], dcNotesPaid };
  }

  ctx.console.log(
    `[Reminder] DC notes for ${customer.code}: ${dcNotesPaid.length} paid, ${unpaidDcNotes.length} unpaid`
  );

  const unpaidSet = new Set(unpaidDcNotes.map((dc) => dc.toLowerCase()));
  const unpaidItems = soaList.filter((soaItem) =>
    unpaidSet.has(soaItem.debitAndCreditNoteNo.toLowerCase())
  );

  return { unpaidItems, dcNotesPaid };
};

type CreateAndSendReminderParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
  unpaidItems: IStatementOfAccountModel[];
  latestLetter: LatestLetter;
  reminderCount: number;
  toEmail: string;
};

const createAndSendReminder = async (
  params: CreateAndSendReminderParams
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

  const letterNo = await ctx.run("generate-letter-number", () =>
    generateLetterNumber(reminderCount.toString(), dateNow)
  );

  await ctx.run("insert-reminder-letter", () =>
    insertReminderLetter({
      reminderId: params.reminder.id,
      type: reminderCount.toString(),
      letterNo,
      referenceId: latestLetter ? latestLetter.id : null,
      sentDate: dateNow,
    })
  );

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
        latestLetter,
        pdfFileName,
      });
      return {
        excelFileName: result.excelFile.fileName,
        pdfFileName: result.pdfFile.fileName,
      };
    }
  );

  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
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
        previousLetterDate: latestLetter?.sentDate,
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

  return { sent: emailResult, dcNotesPaid: [], letterNo, reason: "SENT" };
};

export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = params;
  const processingDate = new Date(item.processingDate);

  const latestLetter = await ctx.run("get-latest-letter", () =>
    getLatestLetter(reminder.id)
  );
  const reminderCount = validateReminderType(ctx, customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

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
    ctx.console.log(
      `[Reminder] Skipping ${customer.code}: no email addresses found`
    );
    return null;
  }

  const unpaidData = await getUnpaidSoaData(
    ctx,
    customer,
    reminder,
    processingDate
  );
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
    toEmail,
  });

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};

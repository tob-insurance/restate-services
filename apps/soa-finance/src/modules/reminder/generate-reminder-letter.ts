import type { ObjectContext } from "@restatedev/restate-sdk";
import { CONTENT_TYPES, isDevelopment, ROMAN_MONTHS } from "../../constants";
import { getAccountEmails } from "../../infrastructure/database/index.js";
import { downloadSoaFiles } from "../../infrastructure/s3";
import type { IAccount, ISoaItem, IStatementOfAccountModel } from "../../types";
import { reminderPdfName } from "../../utils/formatter";
import { readSoaParquet } from "../data-access/parquet-reader";
import { generateAndUploadDocuments } from "../document-generation";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";
import { letterCounter } from "../soa/objects/letter-counter";
import type { LetterRecord } from "../soa/objects/state";
import { stateKeys } from "../soa/objects/state";
import type { IGenerateReminderResult, ISoaReminder } from "./types";

type GenerateReminderLetterParams = {
  ctx: ObjectContext;
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
};

type StoredLetterRecord = Omit<LetterRecord, "status"> & {
  status?: LetterRecord["status"];
};

type LatestLetter = {
  type: string;
  sentDate: Date;
  letterNo: string;
} | null;

const getLetterStateKey = (reminder: ISoaReminder) =>
  stateKeys.letters(reminder.timePeriod, reminder.officeId || "ALL");

const getReminderLetters = async (
  ctx: ObjectContext,
  reminder: ISoaReminder
): Promise<StoredLetterRecord[]> =>
  (await ctx.get<StoredLetterRecord[]>(getLetterStateKey(reminder))) ?? [];

const getLatestSentLetter = (letters: StoredLetterRecord[]): LatestLetter => {
  const latest = letters
    .filter((letter) => !letter.status || letter.status === "sent")
    .reduce<StoredLetterRecord | null>((currentLatest, letter) => {
      if (!currentLatest) {
        return letter;
      }

      return new Date(letter.sentDate).getTime() >
        new Date(currentLatest.sentDate).getTime()
        ? letter
        : currentLatest;
    }, null);

  return latest
    ? {
        type: latest.type,
        sentDate: new Date(latest.sentDate),
        letterNo: latest.letterNo,
      }
    : null;
};

const generateReminderLetterNumber = async (
  ctx: ObjectContext,
  type: string,
  date: Date
): Promise<string> => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const key = `${type}:${year}:${month}`;
  const seqNo = await ctx.objectClient(letterCounter, key).getNext();
  const paddedSeq = seqNo.toString().padStart(3, "0");
  const romanMonth = ROMAN_MONTHS[month - 1];

  return `${paddedSeq}/FIN/SOA/RL${type}/${romanMonth}/${year}`;
};

const upsertLetter = (
  letters: StoredLetterRecord[],
  letter: LetterRecord
): StoredLetterRecord[] => {
  const index = letters.findIndex(
    (existing) =>
      existing.type === letter.type && existing.letterNo === letter.letterNo
  );

  if (index === -1) {
    return [...letters, letter];
  }

  const updatedLetters = [...letters];
  updatedLetters[index] = letter;
  return updatedLetters;
};

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

// biome-ignore lint/nursery/useMaxParams: extracted private helper — parameters are individually meaningful
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

type GenerateUploadResult = { excelFileName: string; pdfFileName: string };

// biome-ignore lint/nursery/useMaxParams: extracted private helper
// biome-ignore lint/suspicious/useAwait: await is inside ctx.run callback
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

// biome-ignore lint/nursery/useMaxParams: extracted private helper
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
        contentType: CONTENT_TYPES.XLSX,
      },
      pdfFile: {
        fileName: fileNames.pdfFileName,
        bytes: pdfBuffer,
        contentType: CONTENT_TYPES.PDF,
      },
      isReminder: item.processingType > 1,
      date: dateNow,
    });
  });
};

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

const createAndSendReminder = async (
  params: CreateAndSendReminderParams
): Promise<IGenerateReminderResult> => {
  const {
    ctx,
    customer,
    reminder,
    item,
    unpaidItems,
    latestLetter,
    reminderCount,
    toEmail,
  } = params;
  const dateNow = new Date(item.processingDate);
  const type = reminderCount.toString();
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  // Phase 1: Assign letter record
  const pendingRecord = await assignLetterRecord(
    ctx,
    reminder,
    type,
    dateNow,
    latestLetter
  );

  // Phase 2: Generate & upload documents
  const fileNames = await generateAndUploadForReminder(
    ctx,
    unpaidItems,
    customer,
    item,
    reminderCount,
    pendingRecord.letterNo,
    latestLetter
  );

  // Phase 3: Download & send email (failure throws -> Restate retry)
  await downloadAndSendReminder(
    ctx,
    customer,
    item,
    type,
    pendingRecord.letterNo,
    latestLetter,
    fileNames,
    branchName,
    unpaidItems,
    toEmail
  );

  // Phase 4: Finalize state
  await finalizeLetterSent(ctx, reminder, pendingRecord);

  return {
    sent: true,
    dcNotesPaid: [],
    letterNo: pendingRecord.letterNo,
    reason: "SENT",
  };
};

export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { ctx, customer, reminder, item } = params;
  const processingDate = new Date(item.processingDate);

  const letters = await getReminderLetters(ctx, reminder);
  const latestLetter = getLatestSentLetter(letters);
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

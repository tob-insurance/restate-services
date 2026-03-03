import {
  completeJobPhase,
  getAccountEmails,
  getLatestLetter,
  insertJobPhase,
  insertReminderLetter,
} from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import {
  type IAccount,
  type ISoaItem,
  type IStatementOfAccountModel,
  SoaPhase,
} from "../../types";
import { reminderPdfName } from "../../utils/formatter";
import {
  generateAndUploadDocuments,
  generateLetterNumber,
} from "../document-generation";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";
import type { IGenerateReminderResult, ISoaReminder } from "./types";

type GenerateReminderLetterParams = {
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
};

type LatestLetter = Awaited<ReturnType<typeof getLatestLetter>>;

const validateReminderType = (
  customer: IAccount,
  item: ISoaItem,
  latestLetter: LatestLetter
): number | null => {
  const previousType = latestLetter
    ? Number.parseInt(latestLetter.type, 10)
    : -1;

  const expectedType = item.processingType - 1;

  if (item.processingType === 1) {
    console.log(
      `Skipping ${customer.code}: Type is SOA but has existing reminders`
    );
    return null;
  }

  if (previousType >= expectedType) {
    console.log(`Skipping ${customer.code}: Already sent type ${previousType}`);
    return null;
  }

  if (expectedType > 3) {
    console.log(`Skipping ${customer.code}: Expected type exceeds max (3)`);
    return null;
  }

  const reminderCount = expectedType;
  console.log(`Processing reminder type ${reminderCount} for ${customer.code}`);
  return reminderCount;
};

const getUnpaidSoaData = async (
  customer: IAccount,
  reminder: ISoaReminder,
  item: ISoaItem
): Promise<{
  unpaidItems: IStatementOfAccountModel[];
  dcNotesPaid: string[];
} | null> => {
  const branchCode = reminder.officeId || "ALL";
  const jobId = item.jobId ?? "";

  await insertJobPhase(jobId, SoaPhase.GetSoa);
  const soaList = await readSoaParquet(customer.code, branchCode);
  await completeJobPhase(jobId, SoaPhase.GetSoa);

  if (soaList.length === 0) {
    return null;
  }

  const currentParquetDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
  const dcNotesPaid = await reconcilePayment(
    reminder.id,
    currentParquetDcNotes
  );

  const paidSet = new Set(dcNotesPaid.map((dc) => dc.toLowerCase()));

  const unpaidDcNotes = currentParquetDcNotes.filter(
    (dc) => !paidSet.has(dc.toLowerCase())
  );

  if (unpaidDcNotes.length === 0) {
    console.log(
      `Skipping reminder for ${customer.code}: All ${dcNotesPaid.length} DC notes have been paid`
    );
    return { unpaidItems: [], dcNotesPaid };
  }

  console.log(
    `DC note status for ${customer.code}: ${dcNotesPaid.length} paid, ${unpaidDcNotes.length} unpaid`
  );

  const unpaidSet = new Set(unpaidDcNotes.map((dc) => dc.toLowerCase()));
  const unpaidItems = soaList.filter((soaItem) =>
    unpaidSet.has(soaItem.debitAndCreditNoteNo.toLowerCase())
  );

  return { unpaidItems, dcNotesPaid };
};

type CreateAndSendReminderParams = {
  customer: IAccount;
  reminder: ISoaReminder;
  item: ISoaItem;
  unpaidItems: IStatementOfAccountModel[];
  latestLetter: LatestLetter;
  reminderCount: number;
  toEmail: string;
  jobId: string;
};

const createAndSendReminder = async (
  params: CreateAndSendReminderParams
): Promise<IGenerateReminderResult> => {
  const {
    customer,
    item,
    unpaidItems,
    latestLetter,
    reminderCount,
    toEmail,
    jobId,
  } = params;
  const dateNow = new Date(item.processingDate);

  const letterNo = await generateLetterNumber(
    reminderCount.toString(),
    dateNow
  );

  await insertReminderLetter({
    reminderId: params.reminder.id,
    type: reminderCount.toString(),
    letterNo,
    referenceId: latestLetter ? latestLetter.id : null,
    sentDate: dateNow,
  });

  const pdfFileName = reminderPdfName(reminderCount);
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";
  const { excelFile, pdfFile } = await generateAndUploadDocuments({
    soaData: unpaidItems,
    customerData: customer,
    params: item,
    branchName,
    letterNo,
    latestLetter,
    pdfFileName,
  });

  await insertJobPhase(jobId, SoaPhase.SendingEmail);

  const totalPremium = unpaidItems.reduce(
    (sum, soaItem) => sum + (soaItem.netPremiumIdr || 0),
    0
  );

  const emailResult = await sendReminderEmail({
    customer,
    toEmail,
    reminderType: reminderCount.toString(),
    letterNo,
    previousLetterNo: latestLetter?.letterNo,
    previousLetterDate: latestLetter?.sentDate,
    branch: branchName,
    totalPremium,
    excelFile,
    pdfFile,
    isReminder: item.processingType > 1,
    date: dateNow,
  });

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return { sent: emailResult, dcNotesPaid: [], letterNo, reason: "SENT" };
};

export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { customer, reminder, item } = params;

  const latestLetter = await getLatestLetter(reminder.id);
  const reminderCount = validateReminderType(customer, item, latestLetter);
  if (reminderCount === null) {
    return null;
  }

  const branchCode = reminder.officeId || "ALL";
  const emails = await getAccountEmails(customer.code, branchCode);
  const toEmail = emails.join(",");

  const unpaidData = await getUnpaidSoaData(customer, reminder, item);
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
    customer,
    reminder,
    item,
    unpaidItems: unpaidData.unpaidItems,
    latestLetter,
    reminderCount,
    toEmail,
    jobId: item.jobId ?? "",
  });

  return { ...result, dcNotesPaid: unpaidData.dcNotesPaid };
};

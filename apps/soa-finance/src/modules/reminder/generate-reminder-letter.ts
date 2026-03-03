import {
  completeJobPhase,
  getAccountEmails,
  getLatestLetter,
  insertJobPhase,
  insertReminderLetter,
} from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import { type IAccount, type ISoaItem, SoaPhase } from "../../types";
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

export const generateReminderLetter = async (
  params: GenerateReminderLetterParams
): Promise<IGenerateReminderResult | null> => {
  const { customer, reminder, item } = params;
  const dateNow = new Date(item.processingDate);

  const branchCode = reminder.officeId || "ALL";

  // Step 1: Get latest reminder letter
  const latestLetter = await getLatestLetter(reminder.id);
  const previousType = latestLetter
    ? Number.parseInt(latestLetter.type, 10)
    : -1;

  // Step 2: Validate processing type
  const expectedType = item.processingType - 1;

  // Skip conditions
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

  // Step 3: Get email recipients
  const emails = await getAccountEmails(customer.code, branchCode);
  const toEmail = emails.join(",");

  const jobId = item.jobId ?? "";

  // Step 4: Get SOA data (Phase: GetSoa)
  await insertJobPhase(jobId, SoaPhase.GetSoa);

  const soaList = await readSoaParquet(customer.code, branchCode);

  await completeJobPhase(jobId, SoaPhase.GetSoa);
  if (soaList.length === 0) {
    return null;
  }

  // Step 5: Compare DC Notes (Paid vs Unpaid)
  const currentParquetDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);
  const dcNotesPaid = await reconcilePayment(
    reminder.id,
    currentParquetDcNotes
  );

  // Step 5.1: Check if all DC Notes are paid - skip email if so
  const unpaidDcNotes = currentParquetDcNotes.filter(
    (dc) => !dcNotesPaid.some((paid) => paid.toLowerCase() === dc.toLowerCase())
  );

  if (unpaidDcNotes.length === 0) {
    console.log(
      `Skipping reminder for ${customer.code}: All ${dcNotesPaid.length} DC notes have been paid`
    );
    return {
      sent: false,
      dcNotesPaid,
      letterNo: null,
      reason: "ALL_PAID",
    };
  }

  console.log(
    `DC note status for ${customer.code}: ${dcNotesPaid.length} paid, ${unpaidDcNotes.length} unpaid`
  );

  // Step 5.2: Filter soaList to include only unpaid items
  // This filter is applied BEFORE generating files,
  // so Excel and PDF only contain outstanding (unpaid) items.
  const unpaidItems = soaList.filter((soaItem) =>
    unpaidDcNotes.some(
      (dc) => dc.toLowerCase() === soaItem.debitAndCreditNoteNo.toLowerCase()
    )
  );

  // Step 6: Generate Letter Number
  const letterNo = await generateLetterNumber(
    reminderCount.toString(),
    dateNow
  );

  // Step 7: Insert Reminder Letter record
  await insertReminderLetter({
    reminderId: reminder.id,
    type: reminderCount.toString(),
    letterNo,
    referenceId: latestLetter ? latestLetter.id : null,
    sentDate: dateNow,
  });

  // Step 8-9: Generate and upload documents
  const pdfFileName = reminderPdfName(reminderCount);
  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";
  const isReminder = item.processingType > 1;
  const { excelFile, pdfFile } = await generateAndUploadDocuments({
    soaData: unpaidItems,
    customerData: customer,
    params: item,
    branchName,
    letterNo,
    latestLetter,
    pdfFileName,
  });

  // Step 10: Send Email (Phase: SendingEmail)
  await insertJobPhase(jobId, SoaPhase.SendingEmail);

  // Calculate total for Email (using unpaidItems defined in Step 5.2)
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
    isReminder,
    date: dateNow,
  });

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return { sent: emailResult, dcNotesPaid, letterNo, reason: "SENT" };
};

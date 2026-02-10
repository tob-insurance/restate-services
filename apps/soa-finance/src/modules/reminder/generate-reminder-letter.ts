import { uploadFile } from "../../infrastructure/azure";
import {
  completeJobPhase,
  getAccountEmails,
  getLatestLetter,
  insertJobPhase,
  insertReminderLetter,
} from "../../infrastructure/database/index.js";
import { readSoaParquet } from "../../pipeline/lib";
import { type IAccount, type ISoaItem, SoaPhase } from "../../types";
import { excelSoaName, reminderPdfName } from "../../utils/formatter";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";
import { generateExcel } from "../soa/excel.generator";
import { buildPdfTemplateData, generateSoaPdfHandler } from "../soa/services";
import { generateLetterNumber } from "./letter-number.generator";
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
  const dateNow = new Date();

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
  const _emails = await getAccountEmails(customer.code, branchCode);
  const toEmail = "gerardus.david@tob-ins.com";

  const jobId = item.jobId ?? "";

  // Step 4: Get SOA data (Phase: GetSoa)
  await insertJobPhase(jobId, SoaPhase.GetSoa);

  const soaList = await readSoaParquet(
    customer.code,
    branchCode,
    item.testMode
  );

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

  // Step 8: Generate Files (Phase: GeneratingFiles)
  await insertJobPhase(jobId, SoaPhase.GeneratingFiles);

  // Generate Excel with ONLY unpaid items (matches C# logic)
  const excelFile = generateExcel({
    soaData: unpaidItems,
    customerId: customer.code,
  });

  const isReminder = reminderCount !== Number(item.processingType);
  const pdfFileName = reminderPdfName(reminderCount);
  const toDate = new Date(item.toDate * 1000);

  const branchName = unpaidItems.length > 0 ? unpaidItems[0].branch : "";

  const pdfTemplateData = await buildPdfTemplateData({
    isReminder,
    toDate,
    customerData: customer,
    branchName,
    soaData: unpaidItems,
    letterNo,
    reminderCount: reminderCount.toString(),
    latestLetter,
  });

  const pdfFileBase64 = await generateSoaPdfHandler({
    templateName: isReminder
      ? "TemplateReminderLetterSOA"
      : "TemplateOutstandingStatementOfAccount",
    data: pdfTemplateData,
    filename: pdfFileName,
  });

  const pdfFile = {
    ...pdfFileBase64,
    bytes: Buffer.from(pdfFileBase64.bytes as string, "base64"),
  };

  await completeJobPhase(jobId, SoaPhase.GeneratingFiles);

  // Step 9: Upload to Azure (Phase: UploadingToAzure)
  await insertJobPhase(jobId, SoaPhase.UploadingToAzure);

  const excelFileName = excelSoaName(customer.code, dateNow);
  await uploadFile(
    {
      ...excelFile,
      fileName: excelFileName,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    customer.code,
    "excel"
  );

  await uploadFile(
    {
      ...pdfFile,
      fileName: pdfFileName,
      contentType: "application/pdf",
    },
    customer.code,
    "pdf"
  );

  await completeJobPhase(jobId, SoaPhase.UploadingToAzure);

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
    testMode: item.testMode,
    isReminder, // Pass the isReminder flag for template selection
  });

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return { sent: emailResult, dcNotesPaid, letterNo, reason: "SENT" };
};

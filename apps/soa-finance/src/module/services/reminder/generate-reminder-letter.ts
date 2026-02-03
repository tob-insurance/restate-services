import { readSoaParquet } from "../../../data-pipeline/lib";
import { uploadFile } from "../../../infrastructure/azure";
import {
  completeJobPhase,
  getAccountEmails,
  getLatestLetter,
  insertJobPhase,
  insertReminderLetter,
} from "../../../infrastructure/database/queries";
import { generateSoaPdfHandler } from "../../handlers";
import { excelSoaName, reminderPdfName } from "../../utils/formatter/naming";
import {
  generateExcel,
  generateLetterNumber,
  getSignature,
} from "../../utils/generators";
import {
  type IAccount,
  type IGenerateReminderResult,
  type ISoaItem,
  type ISoaReminder,
  SoaPhase,
} from "../../utils/types";
import { sendReminderEmail } from "../email/send-reminder";
import { reconcilePayment } from "../payment/reconcile-payment";

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
  const toEmail = "gerardus.david@tob-ins.com"; // for development

  const jobId = item.jobId ?? "";

  // Step 4: Get SOA data (Phase: GetSoa)
  await insertJobPhase(jobId, SoaPhase.GetSoa);

  const soaList = readSoaParquet(customer.code, branchCode);

  await completeJobPhase(jobId, SoaPhase.GetSoa);
  if (soaList.length === 0) {
    return null;
  }

  // Step 5: Compare DC Notes (Paid vs Unpaid)
  // const existingDcNotes = await getDcNoteIdsByCustomer(customer.code);
  // const soaDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);

  // const dcNotesPaid = existingDcNotes.filter(
  //   (dc) => !soaDcNotes.some((soa) => soa.toLowerCase() === dc.toLowerCase()),
  // );

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
  const _dateToString = dateNow.toISOString().split("T")[0];

  const excelFile = generateExcel({
    soaData: soaList,
    customerId: customer.code,
  });

  const isReminder = reminderCount !== Number(item.processingType);

  const pdfFileName = reminderPdfName(reminderCount);

  const pdfFileBase64 = await generateSoaPdfHandler({
    templateName: isReminder
      ? "TemplateReminderLetterSOA"
      : "TemplateOutstandingStatementOfAccount",
    data: {
      asAtDate: item.toDate,
      customerName: customer.fullName,
      virtualAccount: customer.virtualAccount,
      signature: await getSignature(),
    },
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

  // Calculate total, branch, etc for Email
  const branchName = soaList.length > 0 ? soaList[0].branch : "";
  const unpaidItems = soaList.filter((item) =>
    unpaidDcNotes.some(
      (id) => id.toLowerCase() === item.debitAndCreditNoteNo.toLowerCase()
    )
  );
  const totalPremium = unpaidItems.reduce(
    (sum, item) => sum + (item.netPremiumIdr || 0),
    0
  );

  const emailResult = await sendReminderEmail({
    customer,
    toEmail,
    reminderType: reminderCount.toString(),
    letterNo,
    previousLetterNo: latestLetter?.letterNo,
    previousLetterDate: latestLetter?.sentDate, // Ensure this field exists on latestLetter type
    branch: branchName,
    totalPremium,
    excelFile,
    pdfFile,
    testMode: item.testMode,
  });

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return { sent: emailResult, dcNotesPaid, letterNo, reason: "SENT" };
};

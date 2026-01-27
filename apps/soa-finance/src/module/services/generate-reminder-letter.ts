import { readSoaParquet } from "../../data-pipeline/lib";
import { uploadFile } from "../../infrastructure/azure";
import {
  completeJobPhase,
  getAccountEmails,
  getDcNoteIdsByCustomer,
  getLatestLetter,
  insertJobPhase,
  insertReminderLetter,
} from "../../infrastructure/database/queries";
import { generateExcel, generateLetterNo } from "../utils/generators";
import { generateCollectionPdf } from "../utils/generators/pdf/generate-collection-pdf";
import {
  type IAccount,
  type IGenerateReminderResult,
  type ISoaItem,
  type ISoaReminder,
  SoaPhase,
} from "../utils/types";
import { sendReminderEmail } from "./send-reminder-email";

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
  // const toEmail = emails.length > 0 ? emails.join(",") : "finance@tob-ins.com";
  const toEmail = "gerardus.david@tob-ins.com"; // for development

  const jobId = item.jobId ?? "";

  // Step 4: Get SOA data (Phase: GetSoa)
  await insertJobPhase(jobId, SoaPhase.GetSoa);
  const fullName = customer.fullName.replace(/\s+/g, "");

  //tambahkan ini ke service
  const soaList = readSoaParquet(fullName);

  await completeJobPhase(jobId, SoaPhase.GetSoa);
  if (soaList.length === 0) {
    return null;
  }

  // Step 5: Compare DC Notes (Paid vs Unpaid)
  const existingDcNotes = await getDcNoteIdsByCustomer(customer.code);
  const soaDcNotes = soaList.map((s) => s.debitAndCreditNoteNo);

  const dcNotesPaid = existingDcNotes.filter(
    (dc) => !soaDcNotes.some((soa) => soa.toLowerCase() === dc.toLowerCase())
  );
  // Step 6: Generate Letter Number
  const letterNo = await generateLetterNo(reminderCount.toString(), dateNow);
  // Step 7: Insert Reminder Letter record
  await insertReminderLetter({
    reminderId: reminder.id,
    type: reminderCount.toString(),
    letterNo,
    referenceId: latestLetter ? reminder.id : null,
    sentDate: dateNow,
  });

  // Step 8: Generate Files (Phase: GeneratingFiles)
  await insertJobPhase(jobId, SoaPhase.GeneratingFiles);
  const dateToString = dateNow.toISOString().split("T")[0];

  const excelFile = generateExcel({
    soaData: soaList,
    customerId: customer.code,
  });

  const pdfFile = await generateCollectionPdf(
    customer.code,
    customer.fullName,
    dateToString,
    customer.virtualAccount || "-"
  );
  await completeJobPhase(jobId, SoaPhase.GeneratingFiles);

  // Step 9: Upload to Azure (Phase: UploadingToAzure)
  await insertJobPhase(jobId, SoaPhase.UploadingToAzure);
  const prefix = `RL${reminderCount}_`;
  await uploadFile(
    { ...excelFile, fileName: `${prefix}${excelFile.fileName}` },
    customer.code,
    "excel"
  );

  await uploadFile(
    { ...pdfFile, fileName: `${prefix}${pdfFile.fileName}` },
    customer.code,
    "pdf"
  );

  await completeJobPhase(jobId, SoaPhase.UploadingToAzure);

  // Step 10: Send Email (Phase: SendingEmail)
  await insertJobPhase(jobId, SoaPhase.SendingEmail);
  const emailResult = await sendReminderEmail({
    customer,
    toEmail,
    reminderType: reminderCount.toString(),
    letterNo,
    previousLetterNo: latestLetter?.letterNo,
    excelFile,
    pdfFile,
    testMode: item.testMode,
  });

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return { sent: emailResult, dcNotesPaid, letterNo };
};

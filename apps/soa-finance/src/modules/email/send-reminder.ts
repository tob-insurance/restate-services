import { sendEmail } from "../../infrastructure/email";
import type {
  IAccount,
  IEmailAttachment,
  IReminderEmailData,
} from "../../types";
import {
  generateReminderEmailHtml,
  getReminderEmailSubject,
} from "../../utils/email";

type SendReminderEmailParams = {
  customer: IAccount;
  toEmail: string;
  reminderType: string;
  letterNo: string;
  previousLetterNo?: string;
  previousLetterDate?: Date;
  branch?: string;
  totalPremium?: number;
  excelFile: { fileName: string; bytes: Buffer; contentType: string };
  pdfFile: { fileName: string; bytes: Buffer; contentType: string };
  testMode: boolean;
  isReminder?: boolean;
};

export const sendReminderEmail = async (
  params: SendReminderEmailParams,
): Promise<boolean> => {
  const {
    customer,
    toEmail,
    reminderType,
    letterNo,
    previousLetterNo,
    previousLetterDate,
    branch,
    totalPremium,
    testMode,
    excelFile,
    pdfFile,
    isReminder = true,
  } = params;

  const emailData: IReminderEmailData = {
    customerName: customer.fullName,
    asAtDate: new Date(),
    virtualAccount: customer.virtualAccount || "-",
    letterNo,
    previousLetterNo,
    previousLetterDate,
    branch,
    totalPremium,
  };

  // Select template based on whether this is a reminder or initial SOA
  const templateName = isReminder
    ? "TemplateReminderLetterSOA"
    : "TemplateOutstandingStatementOfAccount";

  const htmlContent = await generateReminderEmailHtml(
    reminderType,
    emailData,
    templateName,
  );
  const subject = getReminderEmailSubject(reminderType, customer.fullName);
  const recipient = testMode ? "gerardus.david@tob-ins.com" : toEmail;
  const recipients = recipient.split(",").map((r) => r.trim());
  const attachments: IEmailAttachment[] = [
    {
      name: excelFile.fileName,
      contentType: excelFile.contentType,
      contentBytes: excelFile.bytes.toString("base64"),
    },
    {
      name: pdfFile.fileName,
      contentType: pdfFile.contentType,
      contentBytes: pdfFile.bytes.toString("base64"),
    },
  ];
  await sendEmail({
    to: recipients,
    cc: ["dimaz.putra@tob-ins.com"],
    subject,
    body: htmlContent,
    attachments,
  });
  return true;
};

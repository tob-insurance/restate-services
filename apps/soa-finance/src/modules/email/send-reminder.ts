import { getTestEmailRecipient, isDevelopment } from "../../constants";
import { sendEmail } from "../../infrastructure/email";
import type { IAccount } from "../../types";
import type { IReminderEmailData } from "../reminder/types";
import { buildEmailAttachments, DEFAULT_CC_RECIPIENTS } from "./attachments";
import {
  generateReminderEmailHtml,
  getReminderEmailSubject,
} from "./templates";

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
  isReminder?: boolean;
};

export const sendReminderEmail = async (
  params: SendReminderEmailParams
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
    templateName
  );
  const subject = getReminderEmailSubject(reminderType, customer.fullName);
  const recipient = isDevelopment() ? getTestEmailRecipient() : toEmail;
  const recipients = recipient.split(",").map((r) => r.trim());
  await sendEmail({
    to: recipients,
    cc: DEFAULT_CC_RECIPIENTS,
    subject,
    body: htmlContent,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  });
  return true;
};

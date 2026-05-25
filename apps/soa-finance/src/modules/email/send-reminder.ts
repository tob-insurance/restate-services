import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import { sendEmail } from "../../infrastructure/email";
import type { Account } from "../../types/customer.type.js";
import type { ReminderEmailData } from "../reminder/types.js";
import {
  buildEmailAttachments,
  getCcRecipients,
  resolveRecipientEmail,
} from "./attachments.js";
import {
  generateReminderEmailHtml,
  getReminderEmailSubject,
} from "./templates/reminder.js";

interface SendReminderEmailParams {
  branch?: string;
  customer: Account;
  date: Date;
  excelFile: { fileName: string; bytes: Buffer; contentType: string };
  isReminder?: boolean;
  letterNo: string;
  pdfFile: { fileName: string; bytes: Buffer; contentType: string };
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType: string;
  toEmail: string;
  totalPremium?: number;
}

export const sendReminderEmail = async (
  params: SendReminderEmailParams
): Promise<void> => {
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
    date,
  } = params;

  const emailData: ReminderEmailData = {
    customerName: customer.fullName,
    asAtDate: date,
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
  const recipient = isDevelopment()
    ? getTestEmailRecipient()
    : resolveRecipientEmail(toEmail);
  const recipients = recipient.split(",").map((r) => r.trim());
  const result = await sendEmail({
    to: recipients,
    cc: isDevelopment()
      ? [getTestEmailRecipient()]
      : getCcRecipients(customer.actingCode),
    subject,
    body: htmlContent,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  });

  if (!result) {
    throw new Error(
      `Reminder email failed for ${customer.code} to: ${recipient}`
    );
  }
};

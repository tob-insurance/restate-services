import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import { sendEmail } from "../../infrastructure/email/index.js";
import type { SendEmailResult } from "../../infrastructure/email/types.js";
import type { Account } from "../../types/customer.type.js";
import type { FileData } from "../../types/soa.type.js";
import { formatDateDDMMYYYY } from "../../utils/formatter/date.formatter.js";
import {
  buildEmailAttachments,
  getCcRecipients,
  resolveRecipientEmail,
} from "./attachments.js";
import {
  generateReminderEmailHtml,
  getReminderEmailSubject,
} from "./templates/reminder.js";
import { generateSoaEmailHtml } from "./templates/soa.js";

export interface SendSoaEmailParams {
  branch?: string;
  customerData: Account;
  date: Date;
  excelFile: FileData;
  isReminder?: boolean;
  letterNo?: string;
  pdfFile: FileData;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType?: "1" | "2" | "3";
  /** Override recipient email. If not provided, uses customerData.email. */
  toEmail?: string;
  totalPremium?: number;
}

/**
 * Unified email sender for both SOA and reminder emails.
 * Accepts FileData with S3 keys — downloads from S3 internally.
 */
export async function sendSoaEmail(
  params: SendSoaEmailParams
): Promise<SendEmailResult> {
  const {
    customerData,
    date,
    isReminder,
    reminderType,
    letterNo,
    previousLetterNo,
    previousLetterDate,
    branch,
    toEmail,
    totalPremium,
    excelFile,
    pdfFile,
  } = params;

  const customerEmail = toEmail || customerData.email || "";

  let htmlContent: string;
  let subject: string;

  if (isReminder) {
    const emailData = {
      customerName: customerData.fullName,
      asAtDate: date,
      virtualAccount: customerData.virtualAccount || "-",
      letterNo: letterNo || "",
      previousLetterNo,
      previousLetterDate,
      branch,
      totalPremium,
    };

    const templateName = "TemplateReminderLetterSOA";
    htmlContent = await generateReminderEmailHtml(
      reminderType || "1",
      emailData,
      templateName
    );
    subject = getReminderEmailSubject(
      reminderType || "1",
      customerData.fullName
    );
  } else {
    htmlContent = await generateSoaEmailHtml({
      customerName: customerData.fullName,
      virtualAccount: customerData.virtualAccount || "-",
      asAtDate: date,
    });
    subject = `SOA OUTSTANDING ${customerData.fullName} as ${formatDateDDMMYYYY(date)}`;
  }

  const recipientEmail = isDevelopment()
    ? getTestEmailRecipient()
    : resolveRecipientEmail(customerEmail);

  const recipients = recipientEmail
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  if (recipients.length === 0) {
    throw new Error(`No recipients for ${customerData.code}`);
  }

  const sent = await sendEmail({
    to: recipients,
    cc: isDevelopment()
      ? getTestEmailRecipient()
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0)
      : getCcRecipients(customerData.actingCode),
    subject,
    body: htmlContent,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  });

  if (!sent) {
    throw new Error(
      `Email failed for ${customerData.code} to: ${recipientEmail}`
    );
  }

  return { sent: true };
}

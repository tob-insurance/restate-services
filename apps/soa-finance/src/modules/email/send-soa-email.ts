import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import { sendEmail } from "../../infrastructure/email/index.js";
import type { SendEmailResult } from "../../infrastructure/email/types.js";
import { downloadFile } from "../../infrastructure/s3";
import type { Account } from "../../types/customer.type.js";
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
  excelFileName: string;
  excelUrl: string;
  isReminder?: boolean;
  letterNo?: string;
  pdfFileName: string;
  pdfUrl: string;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType?: "1" | "2" | "3";
  /** Override recipient email. If not provided, uses customerData.email. */
  toEmail?: string;
  totalPremium?: number;
}

/**
 * Unified email sender for both SOA and reminder emails.
 * Replaces send-soa.ts, send-reminder.ts, and send-with-attachments.ts.
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
    excelUrl,
    pdfUrl,
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

  // Download files from S3 object URLs
  const [excelFile, pdfFile] = await Promise.all([
    downloadFile(excelUrl),
    downloadFile(pdfUrl),
  ]);

  const sent = await sendEmail({
    to: recipients,
    cc: isDevelopment()
      ? [getTestEmailRecipient()]
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

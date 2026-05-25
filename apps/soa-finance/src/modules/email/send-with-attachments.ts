import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import type { SendEmailResult } from "../../infrastructure/email/types.js";
import type { Account } from "../../types/customer.type.js";
import type { FileData } from "../../types/soa.type.js";
import { sendReminderEmail } from "./send-reminder.js";
import { sendSoaEmail } from "./send-soa.js";

export interface SendWithAttachmentsParams {
  branch?: string;
  customerData: Account;
  date: Date;
  excelFile: FileData;
  isReminder?: boolean;
  letterNo?: string;
  pdfFile: FileData;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType?: string;
  totalPremium?: number;
}

export async function sendWithAttachments(
  params: SendWithAttachmentsParams
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
    totalPremium,
    excelFile,
    pdfFile,
  } = params;

  const customerEmail = isDevelopment()
    ? getTestEmailRecipient()
    : customerData.email || "";

  if (isReminder) {
    await sendReminderEmail({
      customer: customerData,
      toEmail: customerEmail,
      reminderType: reminderType || "1",
      letterNo: letterNo || "",
      previousLetterNo,
      previousLetterDate,
      branch,
      totalPremium,
      excelFile,
      pdfFile,
      date,
    });
  } else {
    await sendSoaEmail({
      customer: customerData,
      toEmail: customerEmail,
      excelFile,
      pdfFile,
      date,
    });
  }

  return { sent: true };
}

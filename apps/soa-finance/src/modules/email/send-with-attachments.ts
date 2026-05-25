import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import type { ISendEmailResult } from "../../infrastructure/email/types";
import type { IAccount } from "../../types/customer.type.js";
import type { IFileData } from "../../types/soa.type.js";
import { sendReminderEmail } from "./send-reminder";
import { sendSoaEmail } from "./send-soa";

export interface SendWithAttachmentsParams {
  branch?: string;
  customerData: IAccount;
  date: Date;
  excelFile: IFileData;
  isReminder?: boolean;
  letterNo?: string;
  pdfFile: IFileData;
  previousLetterDate?: Date;
  previousLetterNo?: string;
  reminderType?: string;
  totalPremium?: number;
}

export async function sendWithAttachments(
  params: SendWithAttachmentsParams
): Promise<ISendEmailResult> {
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

import {
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants/environment.js";
import { sendEmail } from "../../infrastructure/email";
import type { EmailMessage } from "../../infrastructure/email/types.js";
import type { Account } from "../../types/customer.type.js";
import type { FileData } from "../../types/soa.type.js";
import { formatDateDDMMYYYY } from "../../utils/formatter/date.formatter.js";
import {
  buildEmailAttachments,
  getCcRecipients,
  resolveRecipientEmail,
} from "./attachments.js";
import { generateSoaEmailHtml } from "./templates/soa.js";

interface SendSoaEmailOptions {
  customer: Account;
  date: Date;
  excelFile: FileData;
  pdfFile: FileData;
  toEmail: string;
}

export const sendSoaEmail = async (
  options: SendSoaEmailOptions
): Promise<boolean> => {
  const { customer, toEmail, excelFile, pdfFile, date } = options;
  const asAtDate = date;

  const emailHtml = await generateSoaEmailHtml({
    customerName: customer.fullName,
    virtualAccount: customer.virtualAccount || "-",
    asAtDate,
  });

  const recipientEmail = isDevelopment()
    ? getTestEmailRecipient()
    : resolveRecipientEmail(customer.email || toEmail);

  const message: EmailMessage = {
    to: [recipientEmail],
    cc: isDevelopment()
      ? [getTestEmailRecipient()]
      : getCcRecipients(customer.actingCode),
    subject: `SOA OUTSTANDING ${customer.fullName} as ${formatDateDDMMYYYY(asAtDate)}`,
    body: emailHtml,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  };

  const sent = await sendEmail(message);

  return sent;
};

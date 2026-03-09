import { getTestEmailRecipient, isDevelopment } from "../../constants";
import { sendEmail } from "../../infrastructure/email";
import type { IEmailMessage } from "../../infrastructure/email/types";
import type { IAccount, IFileData } from "../../types";
import { formatDateDDMMYYYY } from "../../utils";
import {
  buildEmailAttachments,
  getCcRecipients,
  resolveRecipientEmail,
} from "./attachments";
import { generateSoaEmailHtml } from "./templates";

type SendSoaEmailOptions = {
  customer: IAccount;
  toEmail: string;
  excelFile: IFileData;
  pdfFile: IFileData;
  date: Date;
};

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

  const message: IEmailMessage = {
    to: [recipientEmail],
    cc: isDevelopment()
      ? [getTestEmailRecipient()]
      : getCcRecipients(customer.actingCode),
    subject: `SOA OUTSTANDING ${customer.fullName} as ${formatDateDDMMYYYY(asAtDate)}`,
    body: emailHtml,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  };

  console.log(`[Email] Sending SOA for ${customer.code} to: ${recipientEmail}`);

  const sent = await sendEmail(message);

  return sent;
};

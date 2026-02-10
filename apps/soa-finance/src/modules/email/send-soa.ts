import { getTestEmailRecipient, isDevelopment } from "../../constants";
import {
  completeJobPhase,
  insertJobPhase,
} from "../../infrastructure/database/index.js";
import { sendEmail } from "../../infrastructure/email";
import type { IEmailMessage } from "../../infrastructure/email/types";
import { type IAccount, type IFileData, SoaPhase } from "../../types";
import { formatDateDDMMYYYY } from "../../utils";
import { buildEmailAttachments, DEFAULT_CC_RECIPIENTS } from "./attachments";
import { generateSoaEmailHtml } from "./templates";

type SendSoaEmailOptions = {
  customer: IAccount;
  toEmail: string;
  excelFile: IFileData;
  pdfFile: IFileData;
  jobId: string;
};

export const sendSoaEmail = async (
  options: SendSoaEmailOptions
): Promise<boolean> => {
  const { customer, toEmail, excelFile, pdfFile, jobId } = options;
  const asAtDate = new Date();

  const emailHtml = await generateSoaEmailHtml({
    customerName: customer.fullName,
    virtualAccount: customer.virtualAccount || "-",
    asAtDate,
  });

  const recipientEmail = isDevelopment()
    ? getTestEmailRecipient()
    : customer.email || toEmail;

  const message: IEmailMessage = {
    to: [recipientEmail],
    cc: DEFAULT_CC_RECIPIENTS,
    subject: `SOA OUTSTANDING ${customer.fullName} as ${formatDateDDMMYYYY(asAtDate)}`,
    body: emailHtml,
    attachments: buildEmailAttachments(excelFile, pdfFile),
  };

  console.log(`Sending SOA email for ${customer.code} to: ${recipientEmail}`);

  await insertJobPhase(jobId, SoaPhase.SendingEmail);
  const sent = await sendEmail(message);
  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return sent;
};

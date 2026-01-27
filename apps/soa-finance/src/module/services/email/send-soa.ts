/**
 * Send SOA email with attachments
 */

import {
  completeJobPhase,
  insertJobPhase,
} from "../../../infrastructure/database/queries";
import { sendEmail } from "../../../infrastructure/email";
import { generateSoaEmailHtml } from "../../utils/email";
import {
  type IAccount,
  type IEmailMessage,
  type IFileData,
  SoaPhase,
} from "../../utils/types";

type SendSoaEmailOptions = {
  customer: IAccount;
  toEmail: string;
  excelFile: IFileData;
  pdfFile: IFileData;
  testMode: boolean;
  jobId: string;
};

export const sendSoaEmail = async (
  options: SendSoaEmailOptions
): Promise<boolean> => {
  const { customer, toEmail, excelFile, pdfFile, testMode, jobId } = options;
  const asAtDate = new Date();

  // Generate email HTML
  const emailHtml = await generateSoaEmailHtml({
    customerName: customer.fullName,
    virtualAccount: customer.virtualAccount || "-",
    asAtDate,
  });

  // In testMode, always use provided email; otherwise use customer email or fallback
  const recipientEmail = testMode ? toEmail : customer.email || toEmail;

  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  // Prepare email message
  const message: IEmailMessage = {
    to: [recipientEmail],
    subject: `SOA OUTSTANDING ${
      customer.fullName
    } as ${asAtDate.toLocaleDateString("id-ID")}`,
    body: emailHtml,
    attachments: [
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
    ],
  };

  await insertJobPhase(jobId, SoaPhase.SendingEmail);

  console.log(`Sending SOA email for ${customer.code} to: ${recipientEmail}`);
  return await sendEmail(message);
};

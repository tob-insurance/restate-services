import { completeJobPhase, insertJobPhase } from "../../database";
import { sendEmail } from "../../infrastructure/email";
import {
  type IAccount,
  type IEmailMessage,
  type IFileData,
  SoaPhase,
} from "../../types";
import { formatDateDDMMYYYY } from "../../utils";
import { generateSoaEmailHtml } from "../../utils/email";

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

  const emailHtml = await generateSoaEmailHtml({
    customerName: customer.fullName,
    virtualAccount: customer.virtualAccount || "-",
    asAtDate,
  });

  const recipientEmail = testMode ? toEmail : customer.email || toEmail;

  const message: IEmailMessage = {
    to: [recipientEmail],
    cc: [recipientEmail],
    // cc: ["rasmi.asih@tob-ins.com"],
    subject: `SOA OUTSTANDING ${customer.fullName} as ${formatDateDDMMYYYY(asAtDate)}`,
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

  console.log(`Sending SOA email for ${customer.code} to: ${recipientEmail}`);

  await insertJobPhase(jobId, SoaPhase.SendingEmail);
  const sent = await sendEmail(message);
  await completeJobPhase(jobId, SoaPhase.SendingEmail);

  return sent;
};

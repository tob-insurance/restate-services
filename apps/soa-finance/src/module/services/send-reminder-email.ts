import { sendEmail } from "../utils/email";
import {
  generateReminderEmailHtml,
  getReminderEmailSubject,
} from "../utils/email/reminderEmail";
import type { IAccount, IEmailAttachment } from "../utils/types";
import type { IReminderEmailData } from "../utils/types/reminder";

type ISendReminderEmailParams = {
  customer: IAccount;
  toEmail: string;
  reminderType: string;
  letterNo: string;
  previousLetterNo?: string;
  excelFile: { fileName: string; bytes: Buffer; contentType: string };
  pdfFile: { fileName: string; bytes: Buffer; contentType: string };
  testMode: boolean;
};

export const sendReminderEmail = async (
  params: ISendReminderEmailParams
): Promise<boolean> => {
  const {
    customer,
    toEmail,
    reminderType,
    letterNo,
    previousLetterNo,
    testMode,
    excelFile,
    pdfFile,
  } = params;

  const emailData: IReminderEmailData = {
    customerName: customer.fullName,
    asAtDate: new Date(),
    virtualAccount: customer.virtualAccount || "-",
    letterNo,
    previousLetterNo,
  };

  const htmlContent = await generateReminderEmailHtml(reminderType, emailData);
  const subject = getReminderEmailSubject(reminderType, customer.fullName);
  const recipient = testMode ? "gerardus.david@tob-ins.com" : toEmail;
  const recipients = recipient.split(",").map((r) => r.trim());
  const attachments: IEmailAttachment[] = [
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
  ];
  await sendEmail({ to: recipients, subject, body: htmlContent, attachments });
  return true;
};

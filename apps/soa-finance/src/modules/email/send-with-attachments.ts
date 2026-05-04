import {
  CONTENT_TYPES,
  getTestEmailRecipient,
  isDevelopment,
} from "../../constants";
import { downloadSoaFiles } from "../../infrastructure/azure";
import type { ISendEmailResult } from "../../infrastructure/email/types";
import type { IAccount } from "../../types";
import { excelSoaName, letterSoaPdfName } from "../../utils";
import { sendSoaEmail } from "./send-soa";

export type SendWithAttachmentsParams = {
  customerId: string;
  customerData: IAccount;
  date: Date;
};

export async function sendWithAttachments(
  params: SendWithAttachmentsParams
): Promise<ISendEmailResult> {
  const { customerId, customerData, date } = params;

  const excelFileName = excelSoaName(customerData.code, date);
  const pdfFileName = letterSoaPdfName(customerData.code);

  const { excelBuffer, pdfBuffer } = await downloadSoaFiles(
    customerId,
    excelFileName,
    pdfFileName
  );

  const excelFile = {
    fileName: excelFileName,
    bytes: excelBuffer,
    contentType: CONTENT_TYPES.XLSX,
  };

  const pdfFile = {
    fileName: pdfFileName,
    bytes: pdfBuffer,
    contentType: CONTENT_TYPES.PDF,
  };

  const customerEmail = isDevelopment()
    ? getTestEmailRecipient()
    : customerData.email || "";
  await sendSoaEmail({
    customer: customerData,
    toEmail: customerEmail,
    excelFile,
    pdfFile,
    date,
  });

  return { sent: true };
}

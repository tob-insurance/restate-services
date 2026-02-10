import { getTestEmailRecipient, isDevelopment } from "../../constants";
import { downloadSoaFiles } from "../../infrastructure/azure";
import type { ISendEmailResult } from "../../infrastructure/email/types";
import type { IAccount } from "../../types";
import { excelSoaName, letterSoaPdfName } from "../../utils";
import { sendSoaEmail } from "./send-soa";

export type SendWithAttachmentsParams = {
  customerId: string;
  customerData: IAccount;
  jobId: string;
  date: Date;
};

export async function sendWithAttachments(
  params: SendWithAttachmentsParams
): Promise<ISendEmailResult> {
  const { customerId, customerData, jobId, date } = params;

  const excelFileName = excelSoaName(customerData.code, date);
  const pdfFileName = letterSoaPdfName(customerData.code);

  try {
    const { excelBuffer, pdfBuffer } = await downloadSoaFiles(
      customerId,
      excelFileName,
      pdfFileName
    );

    const excelFile = {
      fileName: excelFileName,
      bytes: excelBuffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    const pdfFile = {
      fileName: pdfFileName,
      bytes: pdfBuffer,
      contentType: "application/pdf",
    };

    const customerEmail = isDevelopment()
      ? getTestEmailRecipient()
      : customerData.email || "";
    await sendSoaEmail({
      customer: customerData,
      toEmail: customerEmail,
      excelFile,
      pdfFile,
      jobId,
    });

    return { sent: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, reason: message };
  }
}

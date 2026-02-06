import { downloadSoaFiles } from "../../infrastructure/azure";

import { excelSoaName, letterSoaPdfName } from "../../utils";
import type { IAccount, ISendEmailResult } from "../../types";
import { sendSoaEmail } from "./send-soa";

export type SendWithAttachmentsParams = {
  customerId: string;
  customerData: IAccount;
  testMode: boolean;
  jobId: string;
  date: Date;
};

export async function sendWithAttachments(
  params: SendWithAttachmentsParams,
): Promise<ISendEmailResult> {
  const { customerId, customerData, testMode, jobId, date } = params;

  const excelFileName = excelSoaName(customerData.code, date);
  const pdfFileName = letterSoaPdfName(customerData.code);

  try {
    const { excelBuffer, pdfBuffer } = await downloadSoaFiles(
      customerId,
      excelFileName,
      pdfFileName,
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

    const customerEmail = "gerardus.david@tob-ins.com";
    await sendSoaEmail({
      customer: customerData,
      toEmail: customerEmail,
      excelFile,
      pdfFile,
      testMode,
      jobId,
    });

    return { sent: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, reason: message };
  }
}

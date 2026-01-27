/**
 * Download files from Azure and send SOA email
 */

import { v4 as uuid } from "uuid";
import { downloadSoaFiles } from "../../../infrastructure/azure";
import type { IAccount } from "../../utils/types";
import { sendSoaEmail } from "./send-soa";

export type SendWithAttachmentsParams = {
  customerId: string;
  customerData: IAccount;
  testMode: boolean;
  jobId: string;
};

export type SendEmailResult = {
  sent: boolean;
  reason?: string;
};

export async function sendWithAttachments({
  customerId,
  customerData,
  testMode,
  jobId,
}: SendWithAttachmentsParams): Promise<SendEmailResult> {
  const uniqueId = uuid().replace(/-/g, "");
  const excelFileName = `Outstanding-SOA--${customerId}-${uniqueId}.xlsx`;
  const pdfFileName = `Collection_Letter_${customerId}.pdf`;

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

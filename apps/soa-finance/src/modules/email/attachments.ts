import type { IEmailAttachment } from "../../infrastructure/email/types";
import type { IFileData } from "../../types";

export const DEFAULT_CC_RECIPIENTS = ["dimaz.putra@tob-ins.com"];

export const buildEmailAttachments = (
  excelFile: IFileData,
  pdfFile: IFileData
): IEmailAttachment[] => [
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

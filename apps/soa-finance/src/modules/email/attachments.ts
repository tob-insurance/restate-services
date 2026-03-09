import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IEmailAttachment } from "../../infrastructure/email/types";
import type { IFileData } from "../../types";

const FALLBACK_EMAIL = "collection@tob-ins.com";

const CC_FINANCE = "finance@tob-ins.com";
const CC_MKT_NONLEASING = "mkt.nonleasing@tob-ins.com";
const CC_MKT_DIRECTGROUP = "mkt.directgroup@tob-ins.com";

export function getCcRecipients(actingCode: string): string[] {
  if (actingCode === "DIP" || actingCode === "DIG") {
    return [CC_FINANCE, CC_MKT_NONLEASING, CC_MKT_DIRECTGROUP];
  }
  return [CC_FINANCE, CC_MKT_NONLEASING];
}

export function resolveRecipientEmail(email?: string): string {
  return email || FALLBACK_EMAIL;
}

function getSignatureAttachment(): IEmailAttachment | null {
  try {
    const signaturePath = join(__dirname, "../../assets/sign.jpeg");
    const bytes = readFileSync(signaturePath);
    return {
      name: "mgr-signature.jpeg",
      contentType: "image/jpeg",
      contentBytes: bytes.toString("base64"),
      isInline: true,
      contentId: "mgr-signature",
    };
  } catch {
    console.warn("[Email] Signature file not found, skipping inline image");
    return null;
  }
}

export const buildEmailAttachments = (
  excelFile: IFileData,
  pdfFile: IFileData
): IEmailAttachment[] => {
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

  const signature = getSignatureAttachment();
  if (signature) {
    attachments.push(signature);
  }

  return attachments;
};

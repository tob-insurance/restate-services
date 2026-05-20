import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IEmailAttachment } from "../../infrastructure/email/types";
import type { IFileData } from "../../types/soa.type.js";
import { EMAIL_CONFIG } from "../../utils/config/emails.js";
import logger from "../../utils/logger.js";
import { ASSETS_DIR } from "../../utils/paths";

export const FALLBACK_EMAIL = EMAIL_CONFIG.FALLBACK_EMAIL;

export function getCcRecipients(actingCode: string): string[] {
  return EMAIL_CONFIG.getCcRecipients(actingCode);
}

export function resolveRecipientEmail(email?: string): string {
  return email || EMAIL_CONFIG.FALLBACK_EMAIL;
}

function getSignatureAttachment(): IEmailAttachment | null {
  try {
    const signaturePath = join(ASSETS_DIR, "sign.jpeg");
    const bytes = readFileSync(signaturePath);
    return {
      name: "mgr-signature.jpeg",
      contentType: "image/jpeg",
      contentBytes: bytes.toString("base64"),
      isInline: true,
      contentId: "mgr-signature",
    };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      logger.warn(
        { component: "Email" },
        "Signature file not found, skipping inline image"
      );
      return null;
    }

    throw error;
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

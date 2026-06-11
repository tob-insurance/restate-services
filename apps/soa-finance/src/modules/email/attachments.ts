import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmailAttachment } from "../../infrastructure/email/types.js";
import type { FileData } from "../../types/soa.type.js";
import { isS3FileData } from "../../types/soa.type.js";
import { EMAIL_CONFIG } from "../../utils/config/emails.js";
import logger from "../../utils/logger.js";
import { ASSETS_DIR } from "../../utils/paths.js";

export const FALLBACK_EMAIL = EMAIL_CONFIG.FALLBACK_EMAIL;

export function getCcRecipients(actingCode: string): string[] {
  return EMAIL_CONFIG.getCcRecipients(actingCode);
}

export function resolveRecipientEmail(email?: string): string {
  return email || EMAIL_CONFIG.FALLBACK_EMAIL;
}

function getSignatureAttachment(): EmailAttachment | null {
  try {
    const signaturePath = join(ASSETS_DIR, "sign.jpeg");
    const bytes = readFileSync(signaturePath);
    return {
      name: "mgr-signature.jpeg",
      contentType: "image/jpeg",
      contentBytes: bytes.toString("base64"),
      isInline: true,
      contentId: "<mgr-signature>",
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
  excelFile: FileData,
  pdfFile: FileData
): EmailAttachment[] => {
  const attachments: EmailAttachment[] = [];

  // Excel attachment
  if (isS3FileData(excelFile)) {
    // S3-based: pass key, sender will download and stream
    attachments.push({
      name: excelFile.fileName,
      contentType: excelFile.contentType,
      contentBytes: "", // placeholder — sender uses s3Key
      s3Key: excelFile.s3Key,
    });
  } else {
    // Buffer-based
    attachments.push({
      name: excelFile.fileName,
      contentType: excelFile.contentType,
      contentBytes: Buffer.from(excelFile.bytes).toString("base64"),
    });
  }

  // PDF attachment
  if (isS3FileData(pdfFile)) {
    attachments.push({
      name: pdfFile.fileName,
      contentType: pdfFile.contentType,
      contentBytes: "",
      s3Key: pdfFile.s3Key,
    });
  } else {
    attachments.push({
      name: pdfFile.fileName,
      contentType: pdfFile.contentType,
      contentBytes: Buffer.from(pdfFile.bytes).toString("base64"),
    });
  }

  const signature = getSignatureAttachment();
  if (signature) {
    attachments.push(signature);
  }

  return attachments;
};

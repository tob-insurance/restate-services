import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IEmailAttachment } from "../../infrastructure/email/types";
import type { IFileData } from "../../types";
import { ASSETS_DIR } from "../../utils/paths";

export const FALLBACK_EMAIL =
  process.env.SOA_FALLBACK_EMAIL || "collection@tob-ins.com";

function parseEnvCcList(): string[] | null {
  const raw = process.env.SOA_CC_RECIPIENTS;
  if (!raw) {
    return null;
  }
  const items = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  return items.length > 0 ? items : null;
}

const GLOBAL_CC = parseEnvCcList();
const DEFAULT_CC: Record<string, string[]> = {
  DIP: ["finance@tob-ins.com", "mkt.nonleasing@tob-ins.com"],
  DIG: [
    "finance@tob-ins.com",
    "mkt.nonleasing@tob-ins.com",
    "mkt.directgroup@tob-ins.com",
  ],
  DEFAULT: ["finance@tob-ins.com"],
};

export function getCcRecipients(actingCode: string): string[] {
  if (GLOBAL_CC) {
    return GLOBAL_CC;
  }
  return DEFAULT_CC[actingCode] || DEFAULT_CC.DEFAULT;
}

export function resolveRecipientEmail(email?: string): string {
  return email || FALLBACK_EMAIL;
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

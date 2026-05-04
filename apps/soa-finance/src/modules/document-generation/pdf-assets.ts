import { readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = join(__dirname, "../../assets");

let cachedSignature: string | null = null;
let cachedHeader: string | null = null;
let cachedFooter: string | null = null;

function getAssetAsBase64(filename: string): string {
  const filePath = join(ASSETS_DIR, filename);
  const buffer = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();

  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function getSignature(): string {
  if (cachedSignature === null) {
    cachedSignature = getAssetAsBase64("sign.jpeg");
  }

  return cachedSignature;
}

export function getHeader(): string {
  if (cachedHeader === null) {
    cachedHeader = getAssetAsBase64("header-letter.png");
  }

  return cachedHeader;
}

export function getFooter(): string {
  if (cachedFooter === null) {
    cachedFooter = getAssetAsBase64("bottom-letter.png");
  }

  return cachedFooter;
}

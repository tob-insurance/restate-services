import { readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = join(__dirname, "../../../assets");

function getAssetAsBase64(filename: string): string {
  const filePath = join(ASSETS_DIR, filename);
  const buffer = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();

  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function getSignature(): string {
  return getAssetAsBase64("sign.jpeg");
}

export function getHeader(): string {
  return getAssetAsBase64("header-letter.png");
}

export function getFooter(): string {
  return getAssetAsBase64("bottom-letter.png");
}

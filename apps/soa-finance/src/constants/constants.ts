import { CONTENT_TYPES } from "@restate-tob/shared";

export { CONTENT_TYPES, TIMEZONE } from "@restate-tob/shared";

export const ROMAN_MONTHS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export const INFRASTRUCTURE_TIMEOUTS = {
  AZURE_UPLOAD_MS: 10 * 60 * 1000,
  GOTENBERG_PDF_MS: 60_000,
} as const;

export const AZURE_UPLOAD = {
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024,
  BLOCK_SIZE: 4 * 1024 * 1024,
  MAX_CONCURRENCY: 4,
  UPLOAD_TIMEOUT_MS: INFRASTRUCTURE_TIMEOUTS.AZURE_UPLOAD_MS,
} as const;

export const PIPELINE = {
  LARGE_DATASET_WARN_THRESHOLD: 100_000,
} as const;

export const NUMBER_FORMATS = {
  number: "#,##0",
  currency: "#,##0.00",
  date: "dd/mm/yyyy",
  text: "@",
} as const;

// ── Business Rules ──────────────────────────────────────────
export const AGING_THRESHOLD = 60;
export const PERIODS_TO_KEEP = 3;
export const SENTINEL_ALL = "ALL";
export const DOTNET_TICKS_EPOCH_OFFSET = 621_355_968_000_000_000;

const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseSlashDate(value: string): Date | null {
  // Try ISO first
  let d = new Date(value);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1900) {
    return d;
  }

  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, first, second, year] = match;
  const yearNum = Number(year);

  // Try both (first=month, second=day) and (first=day, second=month)
  for (const [month, day] of [
    [Number(first), Number(second)],
    [Number(second), Number(first)],
  ]) {
    d = new Date(yearNum, month - 1, day);
    if (
      d.getFullYear() === yearNum &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
  }

  return null;
}

export function toExcelDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "" || value === "-") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    return parseSlashDate(value);
  }

  return null;
}

export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return CONTENT_TYPES.PDF;
    case "xlsx":
      return CONTENT_TYPES.XLSX;
    case "xls":
      return CONTENT_TYPES.XLS;
    case "html":
      return CONTENT_TYPES.HTML;
    case "csv":
      return CONTENT_TYPES.CSV;
    default:
      return CONTENT_TYPES.OCTET_STREAM;
  }
}

export type NumberFormat = (typeof NUMBER_FORMATS)[keyof typeof NUMBER_FORMATS];
export type RomanMonth = (typeof ROMAN_MONTHS)[number];

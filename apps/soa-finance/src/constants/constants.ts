export const TIMEZONE = "Asia/Jakarta";

// Fallback email when customer has no email
export const FALLBACK_EMAIL = "collection@tob-ins.com";

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

export const CONTENT_TYPES = {
  PDF: "application/pdf",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  XLS: "application/vnd.ms-excel",
  HTML: "text/html",
  CSV: "text/csv",
  OCTET_STREAM: "application/octet-stream",
} as const;

export const NUMBER_FORMATS = {
  number: "#,##0",
  currency: "#,##0.00",
  date: "yyyy-mm-dd",
  text: "@",
} as const;

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
export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];
export type RomanMonth = (typeof ROMAN_MONTHS)[number];

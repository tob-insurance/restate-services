import type { IExcelColumn } from "./types";

export const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

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

export const excelColumns: IExcelColumn[] = [
  { header: "DC Note", key: "debitAndCreditNoteNo", width: 18 },
  { header: "Branch", key: "branch", width: 10 },
  { header: "Policy No", key: "policyNo", width: 20 },
  { header: "Policy End No", key: "policyEndNo", width: 15 },
  { header: "Contract No", key: "contractNo", width: 15 },
  { header: "Plat No", key: "plateNo", width: 12 },
  { header: "Batch No", key: "coInFacRefNo", width: 15 },
  {
    header: "Fire Conjunction Policy",
    key: "fireConjunctionPolicy",
    width: 20,
  },
  { header: "LOB", key: "lob", width: 10 },
  { header: "SOB", key: "sourceOfBusiness", width: 10 },
  { header: "Account Name", key: "accountName", width: 30 },
  { header: "Insured Name", key: "insuredName", width: 30 },
  { header: "Distribution Name", key: "distributionName", width: 25 },
  {
    header: "Distribution Second Name",
    key: "distributionNameSecond",
    width: 25,
  },
  { header: "QQ Name", key: "qualitateQuaName", width: 20 },
  { header: "Effective Date", key: "endEffDate", width: 12 },
  { header: "Expired Date", key: "endExpDate", width: 12 },
  { header: "Post Date", key: "postDate", width: 12 },
  { header: "Aging", key: "aging", width: 10, format: "number" },
  { header: "Currency", key: "currency", width: 10 },
  { header: "Exchange Rate", key: "exchangeRate", width: 12, format: "number" },
  { header: "Endorsement Reason", key: "endReason", width: 20 },
  { header: "Acting Code", key: "actingCode", width: 12 },
  {
    header: "Total Sum Insured",
    key: "totalSumInsured",
    width: 18,
    format: "number",
  },
  { header: "Gross Premium", key: "grossPremium", width: 15, format: "number" },
  { header: "Discount", key: "discount", width: 12, format: "number" },
  { header: "Commission", key: "commission", width: 12, format: "number" },
  { header: "PPN", key: "ppn", width: 12, format: "number" },
  { header: "PPH 21", key: "pph21", width: 12, format: "number" },
  { header: "PPH 23", key: "pph23", width: 12, format: "number" },
  { header: "Cost", key: "cost", width: 12, format: "number" },
  { header: "STMP", key: "stmp", width: 10, format: "number" },
  { header: "Nett Premium", key: "netPremium", width: 15, format: "number" },
  {
    header: "Nett Premium (IDR)",
    key: "netPremiumIdr",
    width: 18,
    format: "number",
  },
  { header: "Installment", key: "installment", width: 12, format: "number" },
  { header: "Due Date", key: "dueDate", width: 12 },
];

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
export type IndonesianMonth = (typeof INDONESIAN_MONTHS)[number];
export type RomanMonth = (typeof ROMAN_MONTHS)[number];

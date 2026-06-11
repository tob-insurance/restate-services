import type { CorrelationId, CustomerId } from "./branded.js";

export const SoaTypeLabels = {
  1: "SOA",
  2: "RL1",
  3: "RL2",
  4: "WL",
} as const;

export const SoaType = {
  SOA: 1,
  RL1: 2,
  RL2: 3,
  WL: 4,
} as const;
export type SoaType = (typeof SoaType)[keyof typeof SoaType];

export interface SoaItem {
  branch: string;
  classOfBusiness: string;
  correlationId?: CorrelationId;
  customerId: CustomerId;
  processingDate: string;
  processingType: SoaType;
  timePeriod: string;
  toDate: number;
}

export interface StatementOfAccountModel {
  accountName: string;
  actingCode: string;
  aging: number;
  branch: string;
  coInFacRefNo: string;
  commission: number;
  contractNo: string;
  cost: number;
  currency: string;
  debitAndCreditNoteNo: string;
  discount: number;
  distributionCode: string;
  distributionName: string;
  distributionNameSecond: string;
  dueDate: string;
  endEffDate: string;
  endExpDate: string;
  endReason: string;
  exchangeRate: number;
  fireConjunctionPolicy: string;
  grossPremium: number;
  installment: string;
  insuredName: string;
  lob: string;
  netPremium: number;
  netPremiumIdr: number;
  origAmount: number;
  plateNo: string;
  policyEndNo: string;
  policyNo: string;
  postDate: string;
  pph21: number;
  pph23: number;
  ppn: number;
  qualitateQuaName: string;
  sourceOfBusiness: string;
  stmp: number;
  totalSumInsured: number;
}

export type FileData = S3FileData | BufferFileData;

export interface S3FileData {
  contentId?: string;
  contentType: string;
  fileName: string;
  isInline?: boolean;
  s3Key: string;
}

export interface BufferFileData {
  bytes: Buffer;
  contentId?: string;
  contentType: string;
  fileName: string;
  isInline?: boolean;
}

/** Type guard to check if FileData has S3 key */
export function isS3FileData(file: FileData): file is S3FileData {
  return "s3Key" in file && typeof file.s3Key === "string";
}

/** Type guard to check if FileData has bytes */
export function isBufferFileData(file: FileData): file is BufferFileData {
  return "bytes" in file && Buffer.isBuffer(file.bytes);
}

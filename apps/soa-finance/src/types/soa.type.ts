export const SoaTypeLabels = {
  1: "SOA",
  2: "RL1",
  3: "RL2",
  4: "WL",
} as const;

export type SoaType = 1 | 2 | 3 | 4;

export interface ISoaItem {
  branch: string;
  classOfBusiness: string;
  customerId: string;
  processingDate: string;
  processingType: SoaType;
  timePeriod: string;
  toDate: number;
}

export interface IStatementOfAccountModel {
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

export interface IFileData {
  bytes: Buffer;
  contentId?: string;
  contentType: string;
  fileName: string;
  isInline?: boolean;
}

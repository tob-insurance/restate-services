export const SoaType = {
  1: "SOA",
  2: "RL1",
  3: "RL2",
  4: "WL",
};

export type SoaType = keyof typeof SoaType;

export const SoaPhase = {
  RetrievingCustomerData: "RetrievingCustomerData",
  CheckingSoaHistory: "CheckingSoaHistory",
  GetSoa: "GetSoa",
  GeneratingFiles: "GeneratingFiles",
  UploadingToAzure: "UploadingToAzure",
  SendingEmail: "SendingEmail",
};

export type SoaPhase = (typeof SoaPhase)[keyof typeof SoaPhase];

export type ISoaItem = {
  customerId: string;
  timePeriod: string;
  processingDate: string;
  batchId: string;
  jobId?: string;
  classOfBusiness: string;
  branch: string;
  toDate: number;
  maxRetries: number;
  processingType: SoaType;
  skipAgingFilter: boolean;
  skipDcNoteCheck: boolean;
};

export type IStatementOfAccountModel = {
  debitAndCreditNoteNo: string;
  branch: string;
  policyNo: string;
  policyEndNo: string;
  contractNo: string;
  plateNo: string;
  coInFacRefNo: string;
  fireConjunctionPolicy: string;
  lob: string;
  sourceOfBusiness: string;
  accountName: string;
  insuredName: string;
  distributionName: string;
  distributionNameSecond: string;
  qualitateQuaName: string;
  endEffDate: string;
  endExpDate: string;
  postDate: string;
  dueDate: string;
  aging: number;
  currency: string;
  exchangeRate: number;
  endReason: string;
  actingCode: string;
  totalSumInsured: number;
  grossPremium: number;
  discount: number;
  commission: number;
  ppn: number;
  pph21: number;
  pph23: number;
  cost: number;
  stmp: number;
  netPremium: number;
  netPremiumIdr: number;
  installment: string;
  origAmount: number;
  dcNoteNo?: string;
  classOfBusiness?: string;
  customerCode: string;
  officeCode?: string;
  distributionCode: string;
};

export type IFileData = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
  isInline?: boolean;
  contentId?: string;
};

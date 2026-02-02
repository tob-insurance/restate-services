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

export const multiBranchCodes = ["DIC", "DIP", "DIG", "DID"];

export type ISoaItem = {
  customerId: string;
  timePeriod: string;
  processingDate: string;
  batchId: string;
  jobId?: string;
  chunkNumber: number;
  classOfBusiness: string;
  branch: string;
  toDate: number;
  maxRetries: number;
  processingType: SoaType;
  testMode: boolean;
  skipAgingFilter: boolean;
  skipDcNoteCheck: boolean;
};

export type ISoaReminder = {
  id: string;
  customerCode: string;
  timePeriod: string;
  officeId: string;
};

export type IProcessReminder = {
  processed: boolean;
  remindersSent: number;
  dcNotesPaid: string[];
};

export type IGenerateReminderResult = {
  sent: boolean;
  dcNotesPaid: string[];
  letterNo?: string;
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
  endEffDate: Date;
  endExpDate: Date;
  postDate: Date;
  dueDate: Date;
  aging: string;
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

export const column = {
  BRANCH: 0,
  POLICY_NO: 1,
  POL_END_NO: 2,
  CONTRACT_NO: 3,
  PLAT_NO: 4,
  CO_IN_FAC_REF_NO: 5,
  FIRE_CONJUNCTION_POL: 6,
  LOB: 7,
  SOB: 8,
  DC_ACCOUNT_FULL_NAME: 9,
  INSURED_NAME: 10,
  DISTRIBUTION_NAME: 11,
  DISTRIBUTION_NAME2: 12,
  QQ_NAME: 13,
  END_EFF_DATE: 14,
  END_EXP_DATE: 15,
  POST_DATE: 16,
  AGING: 17,
  CURR: 18,
  EXCH_RATE: 19,
  END_REASON: 20,
  ACTING_CODE: 21,
  TSI: 22,
  GP: 23,
  DISC: 24,
  COMM: 25,
  PPN: 26,
  PPH21: 27,
  PPH23: 28,
  COST: 29,
  STMP: 30,
  NETT_PREMIUM: 31,
  INST_NO: 32,
  DUE_DATE: 33,
  DC_NOTE: 34,
  ORIG_AMOUNT: 35,
  DISTRIBUTION_CODE: 36,
};

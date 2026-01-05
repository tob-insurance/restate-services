export type OpenBalance = {
  coaCode: string;
  description: string;
  year: number;
  month: number;
  branch: string;
  beginningDebit: number;
  beginningCredit: number;
  debitAmount: number;
  creditAmount: number;
  endingDebit: number;
  endingCredit: number;
  createBy: string;
  createDate: Date;
  currency: string;
};

export type CalculatedTrialBalance = {
  coaCode: string;
  branchCode: string;
  description: string;
  startDebit: number;
  startCredit: number;
  startBalance: number;
  movementDebit: number;
  movementCredit: number;
  movementBalance: number;
  endDebit: number;
  endCredit: number;
  endBalance: number;
  hasAnyValue: boolean;
};

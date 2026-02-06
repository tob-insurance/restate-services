export type IAccount = {
  code: string;
  name?: string;
  fullName: string;
  actingCode: string;
  email?: string;
  virtualAccount?: string;
};

export type IGetSoaJob = {
  jobId: string;
  batchId: number;
  customerId: string;
  status: string;
  retryAttempt: number;
  errorMessage: string;
  startedAt: Date;
  completedAt: Date;
};

export type IBranch = {
  officeCode: string;
  name: string;
};

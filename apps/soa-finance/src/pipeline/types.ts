export type IOracleStreamOptions = {
  procedureName: string;
  binds: Record<string, unknown>;
};

export type ISoaPipelineResult = {
  success: boolean;
  duration: string;
};

export type IDataPipelineResult = {
  success: boolean;
  duration: string;
  filesUploaded: number;
};

export type IPartitionedFile = {
  distributionCode?: string;
  rowCount: number;
  filePath: string;
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

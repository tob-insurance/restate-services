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

export type ServiceResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
};

export type WorkflowResult<T = unknown> = {
  workflowId: string;
  success: boolean;
  data?: T;
  error?: string;
  totalDuration: number;
};

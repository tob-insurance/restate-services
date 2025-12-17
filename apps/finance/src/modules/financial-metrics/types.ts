import type { DateTime } from "luxon";

export type FinancialMetricsResult = {
  success: boolean;
  startTime: DateTime;
  endTime: DateTime;
  duration: number;
  rowsAffected?: number;
  message: string;
  runId?: string;
};

export type CalculationRunStatus = {
  status: string;
  completedSteps: number;
  totalSteps: number;
  errorCount: number;
  warningCount: number;
  metadata: Record<string, unknown>;
};

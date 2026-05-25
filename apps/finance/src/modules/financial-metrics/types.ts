import type { DateTime } from "luxon";

export interface FinancialMetricsResult {
  duration: number;
  endTime: DateTime;
  message: string;
  rowsAffected?: number;
  runId?: string;
  startTime: DateTime;
  success: boolean;
}

export interface CalculationRunStatus {
  completedSteps: number;
  errorCount: number;
  metadata: Record<string, unknown>;
  status: string;
  totalSteps: number;
  warningCount: number;
}

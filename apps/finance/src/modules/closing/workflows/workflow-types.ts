import { DateStringSchema, UserIdSchema } from "@restate-tob/shared";
import type { DateTime } from "luxon";
import { z } from "zod";

export interface WorkflowState {
  currentStep:
    | "idle"
    | "genius-closing"
    | "sync-trial-balance"
    | "financial-metrics"
    | "completed"
    | "failed";
  geniusJobName?: string;
  lastUpdate: string;
  metricsRunId?: string;
  stepStartTime?: string;
}

export interface WorkflowStatus {
  currentStep: WorkflowState["currentStep"];
  geniusJobName?: string;
  lastUpdate: string;
  metricsProgress: {
    status: string;
    completedSteps: number;
    totalSteps: number;
    errorCount: number;
    warningCount: number;
  } | null;
  metricsRunId?: string;
  stepStartTime?: string;
  workflowId: string;
}

export const DailyClosingInput = z.object({
  date: DateStringSchema,
  skipGeniusClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: UserIdSchema.optional(),
});

export const DailyClosingResult = z.object({
  workflowId: z.string(),
  date: z.string(),
  geniusClosing: z
    .object({
      success: z.boolean(),
      startTime: z.string(),
      endTime: z.string(),
      duration: z.number(),
      message: z.string(),
    })
    .optional(),
  financialMetrics: z
    .object({
      success: z.boolean(),
      startTime: z.string(),
      endTime: z.string(),
      duration: z.number(),
      message: z.string(),
    })
    .optional(),
  overallSuccess: z.boolean(),
  totalDuration: z.number(),
});

export interface StepResult {
  duration: number;
  endTime: DateTime;
  message: string;
  startTime: DateTime;
  success: boolean;
}

export type GeniusStepResult = StepResult & {
  jobName?: string;
};

export function formatStepResult(result: StepResult | undefined) {
  if (!result) {
    return;
  }
  return {
    success: result.success,
    startTime: result.startTime.toISO() ?? "",
    endTime: result.endTime.toISO() ?? "",
    duration: result.duration,
    message: result.message,
  };
}

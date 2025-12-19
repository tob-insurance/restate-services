import {
  type Duration,
  TerminalError,
  type WorkflowContext,
  type WorkflowSharedContext,
  workflow,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { z } from "zod";
import {
  calculateFinancialMetrics,
  type FinancialMetricsResult,
  getCalculationRunStatus,
} from "../../financial-metrics/index.js";
import {
  checkGeniusClosingJobStatus,
  submitGeniusClosingJob,
} from "../services/index.js";

type WorkflowState = {
  currentStep:
    | "idle"
    | "oracle-closing"
    | "financial-metrics"
    | "completed"
    | "failed";
  oracleJobName?: string;
  metricsRunId?: string;
  stepStartTime?: string;
  lastUpdate: string;
};

const GENIUS_JOB_CONFIG: {
  initialDelay: Duration;
  pollInterval: Duration;
  maxPollAttempts: number;
} = {
  initialDelay: { hours: 5 },
  pollInterval: { hours: 1 },
  maxPollAttempts: 7,
};

export const DailyClosingInput = z.object({
  date: z.string(),
  skipOracleClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: z.string().optional().default("adm"),
});

export const DailyClosingResult = z.object({
  workflowId: z.string(),
  date: z.string(),
  oracleClosing: z
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

type StepResult = {
  success: boolean;
  startTime: DateTime;
  endTime: DateTime;
  duration: number;
  message: string;
};

function formatStepResult(result: StepResult | undefined) {
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

type OracleStepResult = {
  success: boolean;
  startTime: DateTime;
  endTime: DateTime;
  duration: number;
  message: string;
  jobName?: string;
};

async function executeOracleStep(
  ctx: WorkflowContext,
  closingDate: string,
  userId: string,
  skip: boolean
): Promise<OracleStepResult | undefined> {
  if (skip) {
    ctx.console.log("⏭️  Skipping Genius closing (skipOracleClosing=true)");
    return;
  }

  const startTime = DateTime.fromMillis(await ctx.date.now());

  ctx.console.log("⏳ Step 1: Submitting Genius closing job...");
  ctx.console.log(
    `   Initial delay: ${GENIUS_JOB_CONFIG.initialDelay.hours}h, Poll interval: ${GENIUS_JOB_CONFIG.pollInterval.hours}h`
  );

  const job = await ctx.run("submit-genius-job", async () =>
    submitGeniusClosingJob(closingDate, userId)
  );

  if (!job.submitted) {
    throw new TerminalError(
      `Failed to submit Genius closing job: ${job.message}`
    );
  }

  ctx.console.log(`✅ Job ${job.jobName} submitted successfully`);
  ctx.console.log(
    `⏸️  Waiting ${GENIUS_JOB_CONFIG.initialDelay.hours} hours before first status check...`
  );

  await ctx.sleep(GENIUS_JOB_CONFIG.initialDelay);

  for (
    let attempt = 0;
    attempt < GENIUS_JOB_CONFIG.maxPollAttempts;
    attempt++
  ) {
    ctx.console.log(
      `🔍 Checking job status (attempt ${attempt + 1}/${GENIUS_JOB_CONFIG.maxPollAttempts})...`
    );

    const status = await ctx.run(`check-job-status-${attempt}`, async () =>
      checkGeniusClosingJobStatus(job.jobName)
    );

    if (status.completed) {
      const endTime = DateTime.fromMillis(await ctx.date.now());
      const duration = endTime.diff(startTime, "seconds").seconds;

      ctx.console.log(
        `✅ Genius closing completed in ${Math.round(duration / 3600)}h`
      );

      return {
        success: true,
        startTime,
        endTime,
        duration,
        message: status.message,
        jobName: job.jobName,
      };
    }

    if (status.failed) {
      throw new TerminalError(`Genius closing job failed: ${status.message}`, {
        errorCode: 500,
      });
    }

    if (attempt < GENIUS_JOB_CONFIG.maxPollAttempts - 1) {
      ctx.console.log(
        `⏸️  Job still running. Sleeping for ${GENIUS_JOB_CONFIG.pollInterval.hours} hour(s)...`
      );
      await ctx.sleep(GENIUS_JOB_CONFIG.pollInterval);
    }
  }

  const initialDelayMinutes =
    (GENIUS_JOB_CONFIG.initialDelay.hours || 0) * 60 +
    (GENIUS_JOB_CONFIG.initialDelay.minutes || 0);
  const pollIntervalMinutes =
    (GENIUS_JOB_CONFIG.pollInterval.hours || 0) * 60 +
    (GENIUS_JOB_CONFIG.pollInterval.minutes || 0);

  const totalMinutes =
    initialDelayMinutes +
    GENIUS_JOB_CONFIG.maxPollAttempts * pollIntervalMinutes;
  const totalHours = (totalMinutes / 60).toFixed(2);

  throw new TerminalError(
    `Genius closing job timed out after ${totalMinutes} minutes (${totalHours} hours). Job: ${job.jobName}`,
    { errorCode: 504 }
  );
}

async function executeMetricsStep(
  ctx: WorkflowContext,
  closingDate: string,
  skip: boolean
): Promise<FinancialMetricsResult | undefined> {
  if (skip) {
    ctx.console.log(
      "⏭️  Skipping financial metrics calculation (skipFinancialMetrics=true)"
    );
    return;
  }

  ctx.console.log("⏳ Step 2: Calculating financial metrics...");

  const result = await ctx.run(
    "financial-metrics",
    async () => await calculateFinancialMetrics(closingDate)
  );

  const typedResult = {
    ...result,
    startTime:
      typeof result.startTime === "string"
        ? DateTime.fromISO(result.startTime)
        : result.startTime,
    endTime:
      typeof result.endTime === "string"
        ? DateTime.fromISO(result.endTime)
        : result.endTime,
  } as FinancialMetricsResult;

  if (!result.success) {
    ctx.console.error(
      `❌ Financial metrics calculation failed: ${typedResult.message}`
    );
    throw new Error(
      `Financial metrics calculation failed: ${typedResult.message}`
    );
  }

  ctx.console.log(
    `✅ Financial metrics calculated successfully in ${typedResult.duration}s`
  );

  return typedResult;
}

export const dailyClosingWorkflow = workflow({
  name: "DailyClosing",
  options: {
    abortTimeout: { hours: 13 },
    inactivityTimeout: { hours: 2 },
    workflowRetention: { days: 7 },
    journalRetention: { days: 30 },
    retryPolicy: {
      initialInterval: { seconds: 5 },
      maxInterval: { seconds: 60 },
      maxAttempts: 3,
      onMaxAttempts: "kill",
    },
  },
  handlers: {
    run: async (
      ctx: WorkflowContext,
      input?: z.infer<typeof DailyClosingInput>
    ): Promise<z.infer<typeof DailyClosingResult>> => {
      const workflowId = ctx.key;
      const workflowStartTime = DateTime.fromMillis(await ctx.date.now());

      const closingDate = input?.date || workflowId;
      const skipOracleClosing = input?.skipOracleClosing ?? false;
      const skipFinancialMetrics = input?.skipFinancialMetrics ?? false;
      const userId = input?.userId || "adm";

      ctx.console.log(
        `📅 Starting daily closing workflow for date: ${closingDate}`
      );

      const updateState = async (state: WorkflowState) => {
        ctx.set("state", {
          ...state,
          lastUpdate: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
        });
      };

      await updateState({ currentStep: "idle", lastUpdate: "" });

      let oracleResult: OracleStepResult | undefined;
      let financialMetricsResult: FinancialMetricsResult | undefined;

      try {
        if (!skipOracleClosing) {
          await updateState({
            currentStep: "oracle-closing",
            stepStartTime:
              DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
            lastUpdate: "",
          });
        }

        oracleResult = await executeOracleStep(
          ctx,
          closingDate,
          userId,
          skipOracleClosing
        );

        if (oracleResult?.jobName) {
          await updateState({
            currentStep: "oracle-closing",
            oracleJobName: oracleResult.jobName,
            stepStartTime: oracleResult.startTime.toISO() ?? "",
            lastUpdate: "",
          });
        }

        if (!skipFinancialMetrics) {
          await updateState({
            currentStep: "financial-metrics",
            oracleJobName: oracleResult?.jobName,
            stepStartTime:
              DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
            lastUpdate: "",
          });
        }

        financialMetricsResult = await executeMetricsStep(
          ctx,
          closingDate,
          skipFinancialMetrics
        );

        if (financialMetricsResult?.runId) {
          await updateState({
            currentStep: "financial-metrics",
            oracleJobName: oracleResult?.jobName,
            metricsRunId: financialMetricsResult.runId,
            stepStartTime: financialMetricsResult.startTime.toISO() ?? "",
            lastUpdate: "",
          });
        }

        const totalDuration = DateTime.fromMillis(await ctx.date.now()).diff(
          workflowStartTime,
          "seconds"
        ).seconds;

        await updateState({
          currentStep: "completed",
          oracleJobName: oracleResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
          lastUpdate: "",
        });

        ctx.console.log(
          `🎉 Daily closing workflow completed successfully in ${totalDuration}s`
        );

        return {
          workflowId,
          date: closingDate,
          oracleClosing: formatStepResult(oracleResult),
          financialMetrics: formatStepResult(financialMetricsResult),
          overallSuccess: true,
          totalDuration,
        };
      } catch (error) {
        const totalDuration = DateTime.fromMillis(await ctx.date.now()).diff(
          workflowStartTime,
          "seconds"
        ).seconds;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        await updateState({
          currentStep: "failed",
          oracleJobName: oracleResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
          lastUpdate: "",
        });

        ctx.console.error(`❌ Daily closing workflow failed: ${errorMessage}`);

        return {
          workflowId,
          date: closingDate,
          oracleClosing: formatStepResult(oracleResult),
          financialMetrics: formatStepResult(financialMetricsResult),
          overallSuccess: false,
          totalDuration,
        };
      }
    },

    getStatus: async (ctx: WorkflowSharedContext) => {
      const state = (await ctx.get<WorkflowState>("state")) ?? {
        currentStep: "idle" as const,
        lastUpdate: "",
      };

      let metricsProgress: {
        status: string;
        completedSteps: number;
        totalSteps: number;
        errorCount: number;
        warningCount: number;
      } | null = null;

      if (state.metricsRunId) {
        const metricsRunId = state.metricsRunId;
        const runStatus = await ctx.run(
          "get-metrics-status",
          async () => await getCalculationRunStatus(metricsRunId)
        );
        if (runStatus) {
          metricsProgress = {
            status: runStatus.status,
            completedSteps: runStatus.completedSteps,
            totalSteps: runStatus.totalSteps,
            errorCount: runStatus.errorCount,
            warningCount: runStatus.warningCount,
          };
        }
      }

      return {
        workflowId: ctx.key,
        currentStep: state.currentStep,
        oracleJobName: state.oracleJobName,
        metricsRunId: state.metricsRunId,
        metricsProgress,
        stepStartTime: state.stepStartTime,
        lastUpdate: state.lastUpdate,
      };
    },
  },
});

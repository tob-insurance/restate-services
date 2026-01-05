import {
  type Duration,
  TerminalError,
  type WorkflowContext,
  type WorkflowSharedContext,
  workflow,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { z } from "zod";
import { DEFAULT_USER_ID, GENIUS_JOB_CONFIG } from "../../../constants.js";
import {
  calculateFinancialMetrics,
  type FinancialMetricsResult,
  getCalculationRunStatus,
} from "../../financial-metrics/index.js";
import { syncTrialBalanceFromGeniusAndCalculateMetrics } from "../../trial-balance-sync/index.js";
import {
  checkGeniusClosingJobStatus,
  submitGeniusClosingJob,
} from "../services/index.js";

type WorkflowState = {
  currentStep:
    | "idle"
    | "oracle-closing"
    | "sync-trial-balance"
    | "financial-metrics"
    | "completed"
    | "failed";
  oracleJobName?: string;
  metricsRunId?: string;
  stepStartTime?: string;
  lastUpdate: string;
};

const getGeniusJobDurations = (): {
  initialDelay: Duration;
  pollInterval: Duration;
  maxPollAttempts: number;
} => ({
  initialDelay: { hours: GENIUS_JOB_CONFIG.initialDelayHours },
  pollInterval: { hours: GENIUS_JOB_CONFIG.pollIntervalHours },
  maxPollAttempts: GENIUS_JOB_CONFIG.maxPollAttempts,
});

export const DailyClosingInput = z.object({
  date: z.string(),
  skipOracleClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: z.string().optional(),
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

  const jobConfig = getGeniusJobDurations();
  const currentTime = await ctx.date.now();
  const startTime = DateTime.fromMillis(currentTime);

  ctx.console.log("⏳ Step 1: Submitting Genius closing job...");
  ctx.console.log(
    `   Initial delay: ${GENIUS_JOB_CONFIG.initialDelayHours}h, Poll interval: ${GENIUS_JOB_CONFIG.pollIntervalHours}h`
  );

  const job = await ctx.run("submit-genius-job", async () =>
    submitGeniusClosingJob(closingDate, userId, currentTime)
  );

  if (!job.submitted) {
    throw new TerminalError(
      `Failed to submit Genius closing job: ${job.message}`
    );
  }

  ctx.console.log(`✅ Job ${job.jobName} submitted successfully`);

  const initialStatus = await ctx.run("verify-job-started", async () =>
    checkGeniusClosingJobStatus(job.jobName)
  );

  if (!(initialStatus.running || initialStatus.completed)) {
    throw new TerminalError(
      `Job ${job.jobName} not found in scheduler after submission. Status: ${initialStatus.status}`,
      { errorCode: 500 }
    );
  }

  ctx.console.log(
    `✅ Verified job ${job.jobName} is running (status: ${initialStatus.status})`
  );
  ctx.console.log(
    `⏸️  Waiting ${GENIUS_JOB_CONFIG.initialDelayHours} hours before first status check...`
  );

  await ctx.sleep(jobConfig.initialDelay);

  for (let attempt = 0; attempt < jobConfig.maxPollAttempts; attempt++) {
    ctx.console.log(
      `🔍 Checking job status (attempt ${attempt + 1}/${
        jobConfig.maxPollAttempts
      })...`
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

    if (attempt < jobConfig.maxPollAttempts - 1) {
      ctx.console.log(
        `⏸️  Job still running. Sleeping for ${GENIUS_JOB_CONFIG.pollIntervalHours} hour(s)...`
      );
      await ctx.sleep(jobConfig.pollInterval);
    }
  }

  const initialDelayMinutes = GENIUS_JOB_CONFIG.initialDelayHours * 60;
  const pollIntervalMinutes = GENIUS_JOB_CONFIG.pollIntervalHours * 60;

  const totalMinutes =
    initialDelayMinutes + jobConfig.maxPollAttempts * pollIntervalMinutes;
  const totalHours = (totalMinutes / 60).toFixed(2);

  throw new TerminalError(
    `Genius closing job timed out after ${totalMinutes} minutes (${totalHours} hours). Job: ${job.jobName}`,
    { errorCode: 504 }
  );
}

/**
 * Step 2: Sync trial balance from Genius (Oracle) to PostgreSQL.
 * This ensures the financial metrics calculation uses the latest data from Genius.
 */
async function executeSyncTrialBalanceStep(
  ctx: WorkflowContext,
  closingDate: string,
  skip: boolean
): Promise<boolean> {
  if (skip) {
    ctx.console.log(
      "⏭️  Skipping trial balance sync (skipFinancialMetrics=true)"
    );
    return true;
  }

  ctx.console.log(
    "🔄 Step 2: Syncing trial balance from Genius to PostgreSQL..."
  );

  const currentTime = await ctx.date.now();

  try {
    const result = await ctx.run(
      "sync-trial-balance",
      async () =>
        await syncTrialBalanceFromGeniusAndCalculateMetrics(
          closingDate,
          currentTime
        )
    );

    if (!result.success) {
      ctx.console.error(`❌ Trial balance sync failed: ${result.message}`);
      return false;
    }

    ctx.console.log(
      `✅ Trial balance sync completed successfully: ${result.message}`
    );
    return true;
  } catch (error) {
    ctx.console.error(
      `❌ Trial balance sync failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    return false;
  }
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

  ctx.console.log("⏳ Step 3: Calculating financial metrics...");

  const metricsRunId = ctx.rand.uuidv4();
  const currentTime = await ctx.date.now();

  const result = await ctx.run("financial-metrics", async () =>
    calculateFinancialMetrics(closingDate, metricsRunId, currentTime)
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
    throw new TerminalError(
      `Financial metrics calculation failed: ${typedResult.message}`,
      { errorCode: 500 }
    );
  }

  ctx.console.log(
    `✅ Financial metrics calculated successfully in ${typedResult.duration}s`
  );

  return typedResult;
}
async function updateWorkflowState(
  ctx: WorkflowContext,
  updates: Partial<WorkflowState>
) {
  const currentState = (await ctx.get<WorkflowState>("state")) ?? {
    currentStep: "idle",
    lastUpdate: "",
  };

  ctx.set("state", {
    ...currentState,
    ...updates,
    lastUpdate: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
  });
}

async function processOracleStep(
  ctx: WorkflowContext,
  params: {
    closingDate: string;
    userId: string;
    skip: boolean;
  }
) {
  const { closingDate, userId, skip } = params;

  if (!skip) {
    await updateWorkflowState(ctx, {
      currentStep: "oracle-closing",
      stepStartTime: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
    });
  }

  const result = await executeOracleStep(ctx, closingDate, userId, skip);

  if (result?.jobName) {
    await updateWorkflowState(ctx, {
      currentStep: "oracle-closing",
      oracleJobName: result.jobName,
      stepStartTime: result.startTime.toISO() ?? "",
    });
  }

  return result;
}

async function processSyncTrialBalanceStep(
  ctx: WorkflowContext,
  params: {
    closingDate: string;
    skip: boolean;
    oracleJobName?: string;
  }
) {
  const { closingDate, skip, oracleJobName } = params;

  if (!skip) {
    await updateWorkflowState(ctx, {
      currentStep: "sync-trial-balance",
      oracleJobName,
      stepStartTime: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
    });
  }

  const success = await executeSyncTrialBalanceStep(ctx, closingDate, skip);

  if (!success) {
    throw new TerminalError("Trial balance sync failed", {
      errorCode: 500,
    });
  }
}

async function processFinancialMetricsStep(
  ctx: WorkflowContext,
  params: {
    closingDate: string;
    skip: boolean;
    oracleJobName?: string;
  }
) {
  const { closingDate, skip, oracleJobName } = params;

  if (!skip) {
    await updateWorkflowState(ctx, {
      currentStep: "financial-metrics",
      oracleJobName,
      stepStartTime: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
    });
  }

  const result = await executeMetricsStep(ctx, closingDate, skip);

  if (result?.runId) {
    await updateWorkflowState(ctx, {
      currentStep: "financial-metrics",
      oracleJobName,
      metricsRunId: result.runId,
      stepStartTime: result.startTime.toISO() ?? "",
    });
  }

  return result;
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
      const userId = input?.userId || DEFAULT_USER_ID;

      ctx.console.log(
        `📅 Starting daily closing workflow for date: ${closingDate}`
      );

      await updateWorkflowState(ctx, { currentStep: "idle" });

      let oracleResult: OracleStepResult | undefined;
      let financialMetricsResult: FinancialMetricsResult | undefined;

      try {
        oracleResult = await processOracleStep(ctx, {
          closingDate,
          userId,
          skip: skipOracleClosing,
        });

        await processSyncTrialBalanceStep(ctx, {
          closingDate,
          skip: skipFinancialMetrics,
          oracleJobName: oracleResult?.jobName,
        });

        financialMetricsResult = await processFinancialMetricsStep(ctx, {
          closingDate,
          skip: skipFinancialMetrics,
          oracleJobName: oracleResult?.jobName,
        });

        const totalDuration = DateTime.fromMillis(await ctx.date.now()).diff(
          workflowStartTime,
          "seconds"
        ).seconds;

        await updateWorkflowState(ctx, {
          currentStep: "completed",
          oracleJobName: oracleResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
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
        await updateWorkflowState(ctx, {
          currentStep: "failed",
          oracleJobName: oracleResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
        });

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        ctx.console.error(`❌ Daily closing workflow failed: ${errorMessage}`);

        throw error;
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

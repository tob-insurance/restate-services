import {
  TerminalError,
  type WorkflowContext,
  type WorkflowSharedContext,
  workflow,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import { z } from "zod";
import { DEFAULT_USER_ID } from "../../../constants.js";
import {
  calculateFinancialMetrics,
  type FinancialMetricsResult,
  getCalculationRunStatus,
} from "../../financial-metrics/index.js";
import { syncTrialBalanceFromGeniusAndCalculateMetrics } from "../../trial-balance-sync/index.js";
import { submitGeniusClosingJob } from "../services/index.js";

type WorkflowState = {
  currentStep:
    | "idle"
    | "genius-closing"
    | "sync-trial-balance"
    | "financial-metrics"
    | "completed"
    | "failed";
  geniusJobName?: string;
  metricsRunId?: string;
  stepStartTime?: string;
  lastUpdate: string;
};

export const DailyClosingInput = z.object({
  date: z.string(),
  skipGeniusClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: z.string().optional(),
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

type GeniusStepResult = {
  success: boolean;
  startTime: DateTime;
  endTime: DateTime;
  duration: number;
  message: string;
  jobName?: string;
};

async function executeGeniusStep(
  ctx: WorkflowContext,
  closingDate: string,
  userId: string,
  skip: boolean
): Promise<GeniusStepResult | undefined> {
  if (skip) {
    ctx.console.log("⏭️  Skipping Genius closing (skipGeniusClosing=true)");
    return;
  }

  const currentTime = await ctx.date.now();
  const startTime = DateTime.fromMillis(currentTime);

  ctx.console.log("⏳ Step 1: Running Genius closing procedure...");
  const job = await ctx.run(
    "submit-genius-job",
    async () => submitGeniusClosingJob(closingDate, userId, currentTime),
    { maxRetryAttempts: 1 }
  );

  if (!job.submitted) {
    throw new TerminalError(
      `Failed to submit Genius closing job: ${job.message}`
    );
  }

  const endTime = DateTime.fromMillis(await ctx.date.now());
  const duration = endTime.diff(startTime, "seconds").seconds;

  ctx.console.log(
    `✅ Genius closing ${job.jobName} finished in ${Math.round(duration / 3600)}h`
  );

  return {
    success: true,
    startTime,
    endTime,
    duration,
    message: job.message,
    jobName: job.jobName,
  };
}

/**
 * Step 2: Sync trial balance from Genius PostgreSQL to financial report PostgreSQL.
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

  ctx.console.log("🔄 Step 2: Syncing trial balance from Genius PostgreSQL...");

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
  } catch (error: unknown) {
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

async function processGeniusStep(
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
      currentStep: "genius-closing",
      stepStartTime: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
    });
  }

  const result = await executeGeniusStep(ctx, closingDate, userId, skip);

  if (result?.jobName) {
    await updateWorkflowState(ctx, {
      currentStep: "genius-closing",
      geniusJobName: result.jobName,
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
    geniusJobName?: string;
  }
) {
  const { closingDate, skip, geniusJobName } = params;

  if (!skip) {
    await updateWorkflowState(ctx, {
      currentStep: "sync-trial-balance",
      geniusJobName,
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
    geniusJobName?: string;
  }
) {
  const { closingDate, skip, geniusJobName } = params;

  if (!skip) {
    await updateWorkflowState(ctx, {
      currentStep: "financial-metrics",
      geniusJobName,
      stepStartTime: DateTime.fromMillis(await ctx.date.now()).toISO() ?? "",
    });
  }

  const result = await executeMetricsStep(ctx, closingDate, skip);

  if (result?.runId) {
    await updateWorkflowState(ctx, {
      currentStep: "financial-metrics",
      geniusJobName,
      metricsRunId: result.runId,
      stepStartTime: result.startTime.toISO() ?? "",
    });
  }

  return result;
}

export const dailyClosingWorkflow = workflow({
  name: "DailyClosing",
  options: {
    // The Genius CALL inside ctx.run runs synchronously for up to ~6h.
    // inactivityTimeout must be > the worst-case CALL duration, otherwise
    // Restate considers the invocation hung and tears the stream down.
    abortTimeout: { hours: 13 },
    inactivityTimeout: { hours: 8 },
    workflowRetention: { days: 7 },
    journalRetention: { days: 30 },
    // Handler-level retry policy applies to side effects (`ctx.run`) that
    // do NOT specify their own RunOptions. The Genius CALL pins its own
    // policy explicitly with maxRetryAttempts: 1 (see executeGeniusStep);
    // the values here only govern the lighter-weight idempotent side
    // effects (sync, metrics, status reads) which can safely retry a few
    // times before killing the invocation.
    retryPolicy: {
      initialInterval: { seconds: 5 },
      maxInterval: { seconds: 60 },
      maxAttempts: 5,
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
      const skipGeniusClosing = input?.skipGeniusClosing ?? false;
      const skipFinancialMetrics = input?.skipFinancialMetrics ?? false;
      const userId = input?.userId || DEFAULT_USER_ID;

      ctx.console.log(
        `📅 Starting daily closing workflow for date: ${closingDate}`
      );

      await updateWorkflowState(ctx, { currentStep: "idle" });

      let geniusResult: GeniusStepResult | undefined;
      let financialMetricsResult: FinancialMetricsResult | undefined;

      try {
        geniusResult = await processGeniusStep(ctx, {
          closingDate,
          userId,
          skip: skipGeniusClosing,
        });

        await processSyncTrialBalanceStep(ctx, {
          closingDate,
          skip: skipFinancialMetrics,
          geniusJobName: geniusResult?.jobName,
        });

        financialMetricsResult = await processFinancialMetricsStep(ctx, {
          closingDate,
          skip: skipFinancialMetrics,
          geniusJobName: geniusResult?.jobName,
        });

        const totalDuration = DateTime.fromMillis(await ctx.date.now()).diff(
          workflowStartTime,
          "seconds"
        ).seconds;

        await updateWorkflowState(ctx, {
          currentStep: "completed",
          geniusJobName: geniusResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
        });

        ctx.console.log(
          `🎉 Daily closing workflow completed successfully in ${totalDuration}s`
        );

        return {
          workflowId,
          date: closingDate,
          geniusClosing: formatStepResult(geniusResult),
          financialMetrics: formatStepResult(financialMetricsResult),
          overallSuccess: true,
          totalDuration,
        };
      } catch (error: unknown) {
        await updateWorkflowState(ctx, {
          currentStep: "failed",
          geniusJobName: geniusResult?.jobName,
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
        geniusJobName: state.geniusJobName,
        metricsRunId: state.metricsRunId,
        metricsProgress,
        stepStartTime: state.stepStartTime,
        lastUpdate: state.lastUpdate,
      };
    },
  },
});

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
  const startTime = DateTime.fromMillis(await ctx.date.now());

  ctx.console.log("⏳ Step 1: Submitting Genius closing job...");
  ctx.console.log(
    `   Initial delay: ${GENIUS_JOB_CONFIG.initialDelayHours}h, Poll interval: ${GENIUS_JOB_CONFIG.pollIntervalHours}h`
  );

  const job = await ctx.run("submit-genius-job", async () =>
    submitGeniusClosingJob(closingDate, userId, await ctx.date.now())
  );

  if (!job.submitted) {
    throw new TerminalError(
      `Failed to submit Genius closing job: ${job.message}`
    );
  }

  ctx.console.log(`✅ Job ${job.jobName} submitted successfully`);
  ctx.console.log(
    `⏸️  Waiting ${GENIUS_JOB_CONFIG.initialDelayHours} hours before first status check...`
  );

  await ctx.sleep(jobConfig.initialDelay);

  for (let attempt = 0; attempt < jobConfig.maxPollAttempts; attempt++) {
    ctx.console.log(
      `🔍 Checking job status (attempt ${attempt + 1}/${jobConfig.maxPollAttempts})...`
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
        await updateState({
          currentStep: "failed",
          oracleJobName: oracleResult?.jobName,
          metricsRunId: financialMetricsResult?.runId,
          lastUpdate: "",
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

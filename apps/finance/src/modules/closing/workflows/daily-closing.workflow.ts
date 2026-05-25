import {
  TerminalError,
  type WorkflowContext,
  workflow,
} from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import type { z } from "zod";
import { DEFAULT_USER_ID } from "../../../constants.js";
import type { FinancialMetricsResult } from "../../financial-metrics/index.js";
import {
  executeGeniusStep,
  executeMetricsStep,
  executeSyncTrialBalanceStep,
} from "./step-executors.js";
import { getStatus, updateWorkflowState } from "./workflow-state.js";
import {
  DailyClosingInput,
  type DailyClosingResult,
  formatStepResult,
  type GeniusStepResult,
} from "./workflow-types.js";

export { DailyClosingInput, DailyClosingResult } from "./workflow-types.js";

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

  await executeSyncTrialBalanceStep(ctx, closingDate, skip);
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

      let validatedInput: z.infer<typeof DailyClosingInput>;
      try {
        validatedInput = DailyClosingInput.parse(input ?? {});
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Invalid input";
        ctx.console.error(`Input validation failed: ${message}`);
        throw new TerminalError(`Invalid workflow input: ${message}`);
      }

      const closingDate = validatedInput.date || workflowId;
      const skipGeniusClosing = validatedInput.skipGeniusClosing;
      const skipFinancialMetrics = validatedInput.skipFinancialMetrics;
      const userId = validatedInput.userId ?? DEFAULT_USER_ID;

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

    getStatus,
  },
});

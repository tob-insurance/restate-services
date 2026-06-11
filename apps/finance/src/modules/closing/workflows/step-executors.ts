import { TerminalError, type WorkflowContext } from "@restatedev/restate-sdk";
import { DateTime } from "luxon";
import {
  calculateFinancialMetrics,
  type FinancialMetricsResult,
} from "../../financial-metrics/index.js";
import {
  type SyncTrialBalanceResult,
  syncTrialBalanceFromGenius,
} from "../../trial-balance-sync/sync.service.js";
import { submitGeniusClosingJob } from "../services/genius-closing.service.js";
import type { GeniusStepResult } from "./workflow-types.js";

export async function executeGeniusStep(
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
    async () => submitGeniusClosingJob(closingDate, currentTime, userId),
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
export async function executeSyncTrialBalanceStep(
  ctx: WorkflowContext,
  closingDate: string,
  skip: boolean
): Promise<boolean> {
  if (skip) {
    ctx.console.log(
      "⏭️  Skipping trial balance sync (skipSyncTrialBalance=true)"
    );
    return true;
  }

  ctx.console.log("🔄 Step 2: Syncing trial balance from Genius PostgreSQL...");

  const currentTime = await ctx.date.now();
  const date = DateTime.fromISO(closingDate);
  const result: SyncTrialBalanceResult = await ctx.run(
    "sync-trial-balance",
    async () =>
      await syncTrialBalanceFromGenius(
        date.year.toString(),
        date.month.toString(),
        currentTime
      )
  );

  ctx.console.log(
    `✅ Trial balance sync completed successfully: ${result.message}`
  );
  return true;
}

export async function executeMetricsStep(
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

  const typedResult: FinancialMetricsResult = {
    ...result,
    startTime:
      typeof result.startTime === "string"
        ? DateTime.fromISO(result.startTime)
        : result.startTime,
    endTime:
      typeof result.endTime === "string"
        ? DateTime.fromISO(result.endTime)
        : result.endTime,
  };

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

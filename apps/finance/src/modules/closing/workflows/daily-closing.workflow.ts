import { formatStepResult } from "@restate-tob/shared";
import {
  type WorkflowContext,
  type WorkflowSharedContext,
  workflow,
} from "@restatedev/restate-sdk";
import { z } from "zod";
import {
  calculateFinancialMetrics,
  type FinancialMetricsResult,
} from "../../financial-metrics/index.js";
import {
  executeGeniusClosing,
  type GeniusClosingResult,
} from "../services/index.js";

export const DailyClosingInput = z.object({
  date: z.string(),
  skipOracleClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: z.string().optional().default("ASK"),
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

async function executeOracleStep(
  ctx: WorkflowContext,
  closingDate: string,
  userId: string,
  skip: boolean
): Promise<GeniusClosingResult | undefined> {
  if (skip) {
    ctx.console.log("⏭️  Skipping Genius closing (skipOracleClosing=true)");
    return;
  }

  ctx.console.log("⏳ Step 1: Starting Genius closing procedure...");
  ctx.console.log(
    "   This may take up to 6 hours. Timeout is expected if it takes too long."
  );

  const result = await ctx.run(
    "genius-closing",
    async () => await executeGeniusClosing(closingDate, userId)
  );

  if (result.success) {
    ctx.console.log(`✅ Genius closing completed in ${result.duration}s`);
  } else {
    ctx.console.warn("⚠️ Genius closing returned non-success status");
  }

  return result;
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

  if (!result.success) {
    ctx.console.error(
      `❌ Financial metrics calculation failed: ${result.message}`
    );
    throw new Error(`Financial metrics calculation failed: ${result.message}`);
  }

  ctx.console.log(
    `✅ Financial metrics calculated successfully in ${result.duration}s`
  );

  return result;
}

export const dailyClosingWorkflow = workflow({
  name: "DailyClosing",
  options: {
    abortTimeout: { hours: 7 },
    inactivityTimeout: { hours: 7 },
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
      const workflowStartTime = Date.now();

      const closingDate = input?.date || workflowId;
      const skipOracleClosing = input?.skipOracleClosing ?? false;
      const skipFinancialMetrics = input?.skipFinancialMetrics ?? false;
      const userId = input?.userId || "adm";

      ctx.console.log(
        `📅 Starting daily closing workflow for date: ${closingDate}`
      );

      let oracleResult: GeniusClosingResult | undefined;
      let financialMetricsResult: FinancialMetricsResult | undefined;

      try {
        oracleResult = await executeOracleStep(
          ctx,
          closingDate,
          userId,
          skipOracleClosing
        );

        ctx.console.log(
          "⏸️  Waiting 5 seconds before starting financial metrics..."
        );
        await ctx.sleep({ seconds: 5 });

        financialMetricsResult = await executeMetricsStep(
          ctx,
          closingDate,
          skipFinancialMetrics
        );

        const totalDuration = (Date.now() - workflowStartTime) / 1000;
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
        const totalDuration = (Date.now() - workflowStartTime) / 1000;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

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

    getStatus: async (
      ctx: WorkflowSharedContext
    ): Promise<{
      workflowId: string;
      status: string;
    }> => ({
      workflowId: ctx.key,
      status: "You can check the workflow status in Restate UI",
    }),
  },
});

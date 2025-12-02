import * as restate from "@restatedev/restate-sdk";
import { z } from "zod";
import { executeGeniusClosing } from "../services/geniusClosing";
import { calculateFinancialMetrics } from "../services/financialMetrics";

// Schema for Daily Closing Workflow
export const DailyClosingInput = z.object({
  date: z.string(), // Format: YYYY-MM-DD
  skipOracleClosing: z.boolean().optional().default(false),
  skipFinancialMetrics: z.boolean().optional().default(false),
  userId: z.string().optional().default('ASK'), // User ID for Oracle closing procedure
});

export const DailyClosingResult = z.object({
  workflowId: z.string(),
  date: z.string(),
  oracleClosing: z.object({
    success: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    duration: z.number(),
    message: z.string(),
  }).optional(),
  financialMetrics: z.object({
    success: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    duration: z.number(),
    message: z.string(),
  }).optional(),
  overallSuccess: z.boolean(),
  totalDuration: z.number(),
});

export const dailyClosingWorkflow = restate.workflow({
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
    // Main workflow execution
    run: async (
      ctx: restate.WorkflowContext,
      input?: z.infer<typeof DailyClosingInput>
    ): Promise<z.infer<typeof DailyClosingResult>> => {
      const workflowId = ctx.key; // Unique workflow ID (e.g., "2025-11-24")
      const workflowStartTime = Date.now();

      // If no input provided, use workflow key as date and set defaults
      const closingDate = input?.date || workflowId;
      const skipOracleClosing = input?.skipOracleClosing || false;
      const skipFinancialMetrics = input?.skipFinancialMetrics || false;
      const userId = input?.userId || 'ASK';

      ctx.console.log(`📅 Starting daily closing workflow for date: ${closingDate}`);

      let oracleResult;
      let financialMetricsResult;

      try {
        // Step 1: Execute Genius Oracle Closing (WARNING: can take up to 6 hours)
        // Note: We accept potential timeout, Oracle will continue processing
        if (!skipOracleClosing) {
          ctx.console.log(`⏳ Step 1: Starting Genius closing procedure...`);
          ctx.console.log(`   This may take up to 6 hours. Timeout is expected if it takes too long.`);

          oracleResult = await ctx.run("genius-closing", async () => {
            return await executeGeniusClosing(closingDate, userId);
          });

          if (oracleResult.success) {
            ctx.console.log(`✅ Genius closing completed in ${oracleResult.duration}s`);
          } else {
            ctx.console.warn(`⚠️ Genius closing returned non-success status`);
          }
        } else {
          ctx.console.log(`⏭️  Skipping Genius closing (skipOracleClosing=true)`);
        }

        // Step 2: Wait a bit before starting financial metrics calculation
        ctx.console.log(`⏸️  Waiting 5 seconds before starting financial metrics...`);
        await ctx.sleep({ seconds: 5 });

        // Step 3: Execute PostgreSQL Financial Metrics Calculation
        if (!skipFinancialMetrics) {
          ctx.console.log(`⏳ Step 2: Calculating financial metrics...`);

          financialMetricsResult = await ctx.run("financial-metrics", async () => {
            return await calculateFinancialMetrics(closingDate);
          });

          if (!financialMetricsResult.success) {
            ctx.console.error(`❌ Financial metrics calculation failed: ${financialMetricsResult.message}`);
            throw new Error(`Financial metrics calculation failed: ${financialMetricsResult.message}`);
          }

          ctx.console.log(`✅ Financial metrics calculated successfully in ${financialMetricsResult.duration}s`);
        } else {
          ctx.console.log(`⏭️  Skipping financial metrics calculation (skipFinancialMetrics=true)`);
        }

        const totalDuration = (Date.now() - workflowStartTime) / 1000;

        ctx.console.log(`🎉 Daily closing workflow completed successfully in ${totalDuration}s`);

        // Helper to safely convert Date to ISO string (handles both Date objects and strings from replay)
        const toISOString = (date: Date | string): string => {
          return typeof date === 'string' ? date : date.toISOString();
        };

        return {
          workflowId,
          date: closingDate,
          oracleClosing: oracleResult ? {
            success: oracleResult.success,
            startTime: toISOString(oracleResult.startTime),
            endTime: toISOString(oracleResult.endTime),
            duration: oracleResult.duration,
            message: oracleResult.message,
          } : undefined,
          financialMetrics: financialMetricsResult ? {
            success: financialMetricsResult.success,
            startTime: toISOString(financialMetricsResult.startTime),
            endTime: toISOString(financialMetricsResult.endTime),
            duration: financialMetricsResult.duration,
            message: financialMetricsResult.message,
          } : undefined,
          overallSuccess: true,
          totalDuration,
        };

      } catch (error) {
        const totalDuration = (Date.now() - workflowStartTime) / 1000;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        ctx.console.error(`❌ Daily closing workflow failed: ${errorMessage}`);

        // Helper to safely convert Date to ISO string (handles both Date objects and strings from replay)
        const toISOString = (date: Date | string): string => {
          return typeof date === 'string' ? date : date.toISOString();
        };

        return {
          workflowId,
          date: closingDate,
          oracleClosing: oracleResult ? {
            success: oracleResult.success,
            startTime: toISOString(oracleResult.startTime),
            endTime: toISOString(oracleResult.endTime),
            duration: oracleResult.duration,
            message: oracleResult.message,
          } : undefined,
          financialMetrics: financialMetricsResult ? {
            success: financialMetricsResult.success,
            startTime: toISOString(financialMetricsResult.startTime),
            endTime: toISOString(financialMetricsResult.endTime),
            duration: financialMetricsResult.duration,
            message: financialMetricsResult.message,
          } : undefined,
          overallSuccess: false,
          totalDuration,
        };
      }
    },

    // Query workflow status
    getStatus: async (ctx: restate.WorkflowSharedContext): Promise<{
      workflowId: string;
      status: string;
    }> => {
      return {
        workflowId: ctx.key,
        status: "You can check the workflow status in Restate UI",
      };
    },
  },
});

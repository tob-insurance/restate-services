/**
 * Main workflow entry point
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";
import { workflow } from "@restatedev/restate-sdk";

import {
  getReminderByCustomerAndPeriod,
  updateJobStatus,
} from "../../infrastructure/database/queries";
import {
  handleErrorWithRetry,
  orchestrateNewSoa,
  processReminder,
} from "../handlers";
import {
  ensureJobExists,
  getCustomerData,
  shouldProcessReminder,
} from "../services";

import type { ISoaItem } from "../utils/types";

export const soaWorkflow = workflow({
  name: "SoaWorkflow",
  handlers: {
    run: async (ctx: WorkflowContext, params: ISoaItem) => {
      ctx.console.log("Starting SOA workflow");

      const { customerId, batchId, timePeriod, maxRetries, processingType } =
        params;

      ctx.console.log(`Starting SOA for customer: ${customerId}`);

      // Get or create job
      const { jobId, retryAttempt } = await ctx.run(
        "get-or-create-job",
        async () => await ensureJobExists(batchId, customerId)
      );

      const currentRetryAttempt = retryAttempt;
      let success = false;

      while (!success && currentRetryAttempt <= maxRetries) {
        try {
          // Update status to processing
          await ctx.run("update-processing", async () => {
            await updateJobStatus(jobId, "Processing");
          });

          // Get customer info
          const customerData = await ctx.run(
            "get-customer",
            async () => await getCustomerData(jobId, customerId)
          );

          if (!customerData) {
            throw new Error(`Customer ${customerId} not found`);
          }

          // Check SOA history to decide: new SOA or Reminder Letter
          const existingReminders = await ctx.run(
            "check-soa-history",
            async () =>
              await getReminderByCustomerAndPeriod(
                customerData.code,
                timePeriod
              )
          );

          const shouldDoReminder = shouldProcessReminder(
            existingReminders.length > 0,
            processingType
          );

          if (shouldDoReminder) {
            await processReminder(ctx, customerData, params);
          } else {
            await orchestrateNewSoa(ctx, customerData, params, jobId);
          }

          success = true;
          ctx.console.log(`Completed: ${customerId}`);
        } catch (error: unknown) {
          const errorResult = await handleErrorWithRetry({
            ctx,
            error,
            jobId,
            batchId,
            customerId,
            currentRetryAttempt,
            maxRetries,
          });

          if (!errorResult.shouldContinue) {
            return errorResult.result;
          }
        }
      }

      return { customerId, status: "completed", jobId };
    },
  },
});

export type SoaWorkflow = typeof soaWorkflow;

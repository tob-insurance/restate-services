import type { WorkflowContext } from "@restatedev/restate-sdk";
import { workflow } from "@restatedev/restate-sdk";

import {
  getReminderByCustomerAndPeriod,
  updateJobStatus,
} from "../../infrastructure/database/queries";

import {
  completeWorkflow,
  handleErrorWithRetry,
  newSoa,
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
  options: {
    retryPolicy: {
      initialInterval: { seconds: 1 },
      maxInterval: { seconds: 30 },
      maxAttempts: 3,
    },
  },
  handlers: {
    run: async (ctx: WorkflowContext, params: ISoaItem) => {
      ctx.console.log("Starting SOA workflow");

      const { customerId, batchId, timePeriod, maxRetries, processingType } =
        params;

      ctx.console.log(`Starting SOA for customer: ${customerId}`);

      const { jobId, retryAttempt } = await ctx.run(
        "get-or-create-job",
        async () => await ensureJobExists(batchId, customerId)
      );
      const processingItem: ISoaItem = {
        ...params,
        jobId,
      };

      const currentRetryAttempt = retryAttempt;
      let success = false;

      while (!success && currentRetryAttempt <= maxRetries) {
        try {
          await ctx.run("processing-soa-start", async () => {
            await updateJobStatus(jobId, "Processing");
          });

          const customerData = await ctx.run(
            "get-customer",
            async () => await getCustomerData(jobId, customerId)
          );

          if (!customerData) {
            throw new Error(`Customer ${customerId} not found`);
          }

          // const existingReminders = await ctx.run(
          //   "check-soa-history",
          //   async () =>
          //     await getReminderByCustomerAndPeriod(
          //       customerData.code,
          //       timePeriod,
          //     ),
          // );

          // const shouldDoReminder = shouldProcessReminder(
          //   existingReminders.length > 0,
          //   processingType
          // );

          // if (shouldDoReminder) {
          //   await processReminder(ctx, customerData, processingItem);
          // } else {
          //   await newSoa({ ctx, customerData, params: processingItem, jobId });
          // }

          await newSoa({ ctx, customerData, params: processingItem, jobId });

          success = true;
          ctx.console.log(`Completed: ${customerId}`);

          await completeWorkflow({ ctx, jobId, batchId });
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

import { createHash } from "node:crypto";
import type { WorkflowContext } from "@restatedev/restate-sdk";
import { workflow } from "@restatedev/restate-sdk";
import {
  getAllBranches,
  getJobByBatchAndCustomer,
  getReminderByCustomerAndPeriod,
  insertJob,
  updateJobStatus,
} from "../../infrastructure/database/queries";
import { getCustomerData, shouldProcessReminder } from "../services";
import { processReminderLetter } from "../services/process-reminder-letter";
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
        async () => {
          const existingJob = await getJobByBatchAndCustomer(
            batchId,
            customerId
          );

          const newJobId = createHash("md5")
            .update(batchId + customerId)
            .digest("hex")
            .toString()
            .toUpperCase();

          const retry = existingJob?.retryAttempt || 0;

          if (!existingJob) {
            await insertJob(newJobId, batchId, customerId);
          }

          return { jobId: newJobId, retryAttempt: retry };
        }
      );

      let currentRetryAttempt = retryAttempt;
      let success = false;

      while (!success && currentRetryAttempt <= maxRetries) {
        try {
          // Update status to processing
          await ctx.run("update-processing", async () => {
            await updateJobStatus(jobId, "Processing");
          });

          // Get customer info: displays code, fullname, actingcode and email
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

          const hasExistingReminders = existingReminders.length > 0;
          const shouldDoReminder = shouldProcessReminder(
            hasExistingReminders,
            processingType
          );

          if (shouldDoReminder) {
            // Do reminder

            const _branchesForReminder = await ctx.run(
              "get-branches-for-reminder",
              async () => await getAllBranches()
            );

            await ctx.run(
              "process-reminder",
              async () =>
                await processReminderLetter({
                  customer: customerData,
                  item: params,
                })
            );
          }

          success = true;
        } catch (_error) {
          currentRetryAttempt += 1;
        }
      }
    },
  },
});

export type SoaWorkflow = typeof soaWorkflow;

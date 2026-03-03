import type { WorkflowContext } from "@restatedev/restate-sdk";
import { TerminalError, workflow } from "@restatedev/restate-sdk";

import {
  getAccountById,
  getReminderByCustomerAndPeriod,
  updateJobStatus,
} from "../../../infrastructure/database/index.js";
import { type ISoaItem, SoaPhase } from "../../../types";
import { ensureJobExists, trackPhase } from "../../job";
import { processReminderLetter } from "../../reminder";
import { completeWorkflow, newSoa } from "../services";

type ISoaWorkflowResult = {
  customerId: string;
  status: "completed" | "failed";
  jobId: string;
};

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
    run: async (
      ctx: WorkflowContext,
      soaParams: ISoaItem
    ): Promise<ISoaWorkflowResult> => {
      const { customerId, batchId, timePeriod, processingType } = soaParams;

      ctx.console.log(`Starting SOA for customer: ${customerId}`);

      const { jobId } = await ctx.run(
        "get-or-create-job",
        async () => await ensureJobExists(batchId, customerId)
      );

      const processingItem: ISoaItem = {
        ...soaParams,
        jobId,
      };

      await ctx.run("update-job-processing", async () => {
        await updateJobStatus(jobId, "Processing");
      });

      const customerData = await trackPhase(
        ctx,
        jobId,
        SoaPhase.RetrievingCustomerData,
        () => ctx.run("get-customer-data", () => getAccountById(customerId))
      );

      if (!customerData) {
        throw new TerminalError(`Customer ${customerId} tidak ditemukan`);
      }

      const existingReminders = await ctx.run(
        "check-soa-history",
        async () =>
          await getReminderByCustomerAndPeriod(customerData.code, timePeriod)
      );

      const hasExistingReminder = existingReminders.length > 0;
      const shouldCreateReminder = hasExistingReminder || processingType !== 1;

      if (shouldCreateReminder) {
        await processReminderLetter({
          customer: customerData,
          item: processingItem,
        });
      } else {
        await newSoa({
          ctx,
          customerData,
          params: processingItem,
          jobId,
        });
      }

      await completeWorkflow({ ctx, jobId, batchId });

      ctx.console.log(`selesai: ${customerId}`);

      return {
        customerId,
        status: "completed",
        jobId,
      };
    },
  },
});

export type SoaWorkflow = typeof soaWorkflow;

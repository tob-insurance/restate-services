/**
 * Orchestrate new SOA processing flow
 * Coordinates SOA generation, email sending, and reminder scheduling
 */

import type { WorkflowContext } from "@restatedev/restate-sdk";

import { isMultiBranchCustomer, sendWithAttachments } from "../../services";
import type { IAccount, ISoaItem } from "../../utils/types";
import { runReminderSchedule } from "../reminder/run-schedule";
import { completeWorkflow } from "../workflow/complete";
import { processMultiBranchSoa } from "./process-multi-branch";
import { processSingleBranchSoa } from "./process-single-branch";

export async function orchestrateNewSoa(
  ctx: WorkflowContext,
  customerData: IAccount,
  params: ISoaItem,
  jobId: string
): Promise<void> {
  // Process SOA based on customer type
  if (isMultiBranchCustomer(customerData.actingCode)) {
    await processMultiBranchSoa({ ctx, customerData, params });
  } else {
    await processSingleBranchSoa({ ctx, customerData, params });
  }

  // Send Email
  await ctx.run(
    "send-email",
    async () =>
      await sendWithAttachments({
        customerId: params.customerId,
        customerData,
        testMode: params.testMode,
        jobId,
      })
  );

  // Run reminder schedule
  await runReminderSchedule({ ctx, customerData, params });

  // Complete workflow
  await completeWorkflow({ ctx, jobId, batchId: params.batchId });
}

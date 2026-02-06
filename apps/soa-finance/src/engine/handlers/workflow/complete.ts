import type { WorkflowContext } from "@restatedev/restate-sdk";

import {
  incrementProcessedAndCheckComplete,
  updateBatchStatus,
  updateJobStatus,
} from "../../../database";

export type CompleteWorkflowParams = {
  ctx: WorkflowContext;
  jobId: string;
  batchId: string;
};

export async function completeWorkflow({
  ctx,
  jobId,
  batchId,
}: CompleteWorkflowParams): Promise<void> {
  await ctx.run("customer-completed", async () => {
    await updateJobStatus(jobId, "Completed");
  });

  await ctx.run("batch-completed", async () => {
    const { isComplete, status } =
      await incrementProcessedAndCheckComplete(batchId);
    if (isComplete) {
      await updateBatchStatus(batchId, status);
      ctx.console.log(`Batch ${batchId} completed with status ${status}`);
    }
  });
}

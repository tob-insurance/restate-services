import type { WorkflowContext } from "@restatedev/restate-sdk";

import { incrementFailedCount, updateJobStatus } from "../../../database";

export type ErrorWithRetryOptions = {
  ctx: WorkflowContext;
  error: unknown;
  jobId: string;
  batchId: string;
  customerId: string;
  currentRetryAttempt: number;
  maxRetries: number;
};

export type ErrorWithRetryResult = {
  shouldContinue: boolean;
  result?: { customerId: string; status: string; error: string };
};

export async function handleErrorWithRetry(
  options: ErrorWithRetryOptions
): Promise<ErrorWithRetryResult> {
  const {
    ctx,
    error,
    jobId,
    batchId,
    customerId,
    currentRetryAttempt,
    maxRetries,
  } = options;

  const errorMessage = error instanceof Error ? error.message : String(error);

  if (currentRetryAttempt <= maxRetries) {
    await ctx.run(`mark-retrying-${currentRetryAttempt}`, async () => {
      await updateJobStatus(
        jobId,
        "Retrying",
        errorMessage,
        currentRetryAttempt
      );
    });

    ctx.console.log(`Retrying (${currentRetryAttempt}/${maxRetries})`);
    await ctx.sleep(1000 * currentRetryAttempt);
    return { shouldContinue: true };
  }

  await ctx.run("mark-failed", async () => {
    await updateJobStatus(
      jobId,
      "Failed",
      `Failed after ${maxRetries} attempts: ${errorMessage}`
    );
    await incrementFailedCount(batchId);
  });

  ctx.console.log(`Failed after ${maxRetries} retries`);
  return {
    shouldContinue: false,
    result: { customerId, status: "failed", error: errorMessage },
  };
}

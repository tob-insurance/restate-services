/**
 * Job management - create or get existing job
 */

import { createHash } from "node:crypto";
import {
  getJobByBatchAndCustomer,
  insertJob,
} from "../../../infrastructure/database/queries";

export type JobInfo = {
  jobId: string;
  retryAttempt: number;
};

export async function ensureJobExists(
  batchId: string,
  customerId: string,
  chunkNumber: number
): Promise<JobInfo> {
  const existingJob = await getJobByBatchAndCustomer(batchId, customerId);

  const newJobId = createHash("md5")
    .update(batchId + customerId)
    .digest("hex")
    .toString()
    .toUpperCase();

  const retry = existingJob?.retryAttempt || 0;

  if (!existingJob) {
    await insertJob(newJobId, batchId, customerId, chunkNumber);
  }

  return { jobId: newJobId, retryAttempt: retry };
}

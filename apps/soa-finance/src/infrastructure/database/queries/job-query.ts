import { executeQuery } from "../database";
import type { IGetSoaJob } from "../types";

/**
 * Insert a new job
 */
export const insertJob = async (
  jobId: string,
  batchId: string,
  customerId: string
) => {
  const sql = `
    INSERT INTO SOA_PROCESSING_JOBS
    (JOB_ID, BATCH_ID, CUSTOMER_ID, STATUS, RETRY_ATTEMPT, STARTED_AT)
    VALUES (hextoraw(:jobId), hextoraw(:batchId), :customerId, 'Queued', 0, SYSDATE)
  `;

  await executeQuery(sql, { jobId, batchId, customerId }, { autoCommit: true });

  return jobId;
};

export const getJobByBatchAndCustomer = async (
  batchId: string,
  customerId: string
): Promise<IGetSoaJob | null> => {
  const query = `
    SELECT RAWTOHEX(JOB_ID) AS "jobId",
           RAWTOHEX(BATCH_ID) AS "batchId",
           CUSTOMER_ID AS "customerId",
           STATUS AS "status",
           RETRY_ATTEMPT AS "retryAttempt",
           ERROR_MESSAGE AS "errorMessage",
           STARTED_AT AS "startedAt",
           COMPLETED_AT AS "completedAt"
    FROM SOA_PROCESSING_JOBS
    WHERE BATCH_ID = hextoraw(:batchId)
      AND CUSTOMER_ID = :customerId
  `;

  const result = await executeQuery(query, { batchId, customerId });
  const rows = result.rows?.[0] as IGetSoaJob | null;

  return rows;
};

/**
 * Update job status
 */
export const updateJobStatus = async (
  jobId: string,
  status: string,
  errorMessage?: string,
  retryAttempt?: number
) => {
  const query = `
    UPDATE SOA_PROCESSING_JOBS
    SET STATUS = :status,
        ERROR_MESSAGE = :err,
        RETRY_ATTEMPT = NVL(:retry, RETRY_ATTEMPT),
        COMPLETED_AT = CASE WHEN :status IN ('Completed', 'Failed') THEN SYSDATE END
    WHERE JOB_ID = hextoraw(:jobId)
  `;

  await executeQuery(
    query,
    {
      jobId,
      status,
      err: errorMessage ?? null,
      retry: retryAttempt ?? null,
    },
    { autoCommit: true }
  );
};

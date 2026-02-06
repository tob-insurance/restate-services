import { executeQuery } from "../database";

type BatchStatusRow = {
  totalCustomers: number;
  processedCustomers: number;
  failedCustomers: number;
};

export const insertBatch = async (
  batchId: string,
  total: number,
  status: string
) => {
  const query = `
    INSERT INTO SOA_PROCESSING_BATCHES
    (BATCH_ID, STATUS, TOTAL_CUSTOMERS, PROCESSED_CUSTOMERS, FAILED_CUSTOMERS, CREATED_AT)
    VALUES (hextoraw(:batchId), :status, :total, 0, 0, SYSDATE)
  `;

  await executeQuery(query, { batchId, status, total }, { autoCommit: true });
  return batchId;
};

export const updateBatchStatus = async (batchId: string, status: string) => {
  const query = `
    UPDATE SOA_PROCESSING_BATCHES
    SET STATUS = :status,
        COMPLETED_AT = SYSDATE
    WHERE BATCH_ID = hextoraw(:batchId)
  `;

  await executeQuery(query, { batchId, status }, { autoCommit: true });
};

/**
 * Increment processed count and check if batch is complete (Event-Driven Counter)
 * Returns true if this was the last customer to complete
 */
export const incrementProcessedAndCheckComplete = async (
  batchId: string
): Promise<{ isComplete: boolean; status: string }> => {
  await executeQuery(
    `UPDATE SOA_PROCESSING_BATCHES
     SET PROCESSED_CUSTOMERS = PROCESSED_CUSTOMERS + 1
     WHERE BATCH_ID = hextoraw(:batchId)`,
    { batchId },
    { autoCommit: true }
  );

  // Get current status
  const result = await executeQuery(
    `SELECT TOTAL_CUSTOMERS as "totalCustomers", 
            PROCESSED_CUSTOMERS as "processedCustomers", 
            FAILED_CUSTOMERS as "failedCustomers"
     FROM SOA_PROCESSING_BATCHES
     WHERE BATCH_ID = hextoraw(:batchId)`,
    { batchId }
  );

  const row = result.rows?.[0] as BatchStatusRow | undefined;
  if (!row) {
    return { isComplete: false, status: "Unknown" };
  }

  const total = row.totalCustomers ?? 0;
  const processed = row.processedCustomers ?? 0;
  const failed = row.failedCustomers ?? 0;
  const totalDone = processed + failed;

  if (totalDone >= total) {
    // Determine final status
    let status = "Completed";
    if (failed > 0 && processed > 0) {
      status = "Partially Failed";
    } else if (processed === 0) {
      status = "Failed";
    }
    return { isComplete: true, status };
  }

  return { isComplete: false, status: "Processing" };
};

/**
 * Increment failed customers count
 */
export const incrementFailedCount = async (batchId: string) => {
  const sql = `
    UPDATE SOA_PROCESSING_BATCHES
    SET FAILED_CUSTOMERS = FAILED_CUSTOMERS + 1
    WHERE BATCH_ID = hextoraw(:batchId)
  `;

  await executeQuery(sql, { batchId }, { autoCommit: true });
};

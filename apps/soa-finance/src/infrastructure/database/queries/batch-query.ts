import { executeQuery } from "../database";

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

import { PIPELINE } from "../../constants";
import { uploadParquetToStorage } from "../../infrastructure/s3/pipeline-storage";
import type { IStatementOfAccountModel } from "../../types";
import { writeSoaParquetToBuffer } from "../lib";

export async function writeToParquet(
  source: AsyncIterable<IStatementOfAccountModel>,
  referenceDate: Date
) {
  const datasAccount = new Map<string, IStatementOfAccountModel[]>();

  for await (const row of source) {
    const accountCode = row.distributionCode;

    if (!datasAccount.has(accountCode)) {
      datasAccount.set(accountCode, []);
    }

    datasAccount.get(accountCode)?.push(row);
  }

  let totalRows = 0;
  for (const rows of datasAccount.values()) {
    totalRows += rows.length;
  }
  if (totalRows > PIPELINE.LARGE_DATASET_WARN_THRESHOLD) {
    console.warn(
      `[Pipeline] Large dataset: ${totalRows} rows across ${datasAccount.size} accounts. Consider batching.`
    );
  }
  console.log(
    `[Pipeline] Writing ${totalRows} rows for ${datasAccount.size} accounts`
  );

  const result = await uploadAccounts(datasAccount, referenceDate);

  if (result.failed > 0 && result.uploaded === 0 && datasAccount.size > 0) {
    throw new Error(
      `Failed to upload for all ${datasAccount.size} accounts. Errors: ${result.errors.slice(0, 3).join(" | ")}`
    );
  }
}

async function uploadAccounts(
  datasAccount: Map<string, IStatementOfAccountModel[]>,
  referenceDate: Date
): Promise<{
  uploaded: number;
  failed: number;
  failedAccounts: string[];
  errors: string[];
}> {
  let uploaded = 0;
  let failed = 0;
  const failedAccounts: string[] = [];
  const errors: string[] = [];

  for (const [distributionCode, rows] of datasAccount) {
    const fileName = `soa_${distributionCode}.parquet`;

    try {
      const buffer = writeSoaParquetToBuffer(rows);

      const result = await uploadParquetToStorage(
        fileName,
        buffer,
        referenceDate
      );

      if (!result.success) {
        throw new Error(`Failed to upload ${fileName}`);
      }

      uploaded += 1;
      console.log(
        `[Pipeline] Uploaded ${rows.length} rows for ${distributionCode} to ${result.key}`
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failedAccounts.push(distributionCode);
      errors.push(`${distributionCode}: ${message}`);
      console.error(
        `[Pipeline] Failed to upload account ${distributionCode}: ${message}`
      );
    }
  }

  console.log(`[Pipeline] Uploaded: ${uploaded}, Failed: ${failed}`);

  if (failed > 0) {
    for (const accountCode of failedAccounts) {
      console.error(`[Pipeline] Failed account: ${accountCode}`);
    }
  }

  return { uploaded, failed, failedAccounts, errors };
}

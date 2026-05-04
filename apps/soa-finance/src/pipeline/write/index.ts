import { PIPELINE } from "../../constants";
import { uploadParquetToStorage } from "../../infrastructure/azure/pipeline-storage";
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

  for (const [distributionCode, rows] of datasAccount) {
    const fileName = `soa_${distributionCode}.parquet`;

    const buffer = writeSoaParquetToBuffer(rows);

    const result = await uploadParquetToStorage(
      fileName,
      buffer,
      referenceDate
    );

    if (!result.success) {
      throw new Error(`Failed to upload ${fileName}`);
    }

    console.log(
      `[Pipeline] Uploaded ${rows.length} rows for ${distributionCode} to ${result.key}`
    );
  }
}

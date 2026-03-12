import { uploadParquetToStorage } from "../../infrastructure/pipeline-storage";
import type { IStatementOfAccountModel } from "../../types";
import { writeSoaParquetToBuffer } from "../lib";

export async function writeToParquet(
  source: AsyncIterable<IStatementOfAccountModel>
) {
  const datasAccount = new Map<string, IStatementOfAccountModel[]>();

  for await (const row of source) {
    const accountCode = row.distributionCode;

    if (!datasAccount.has(accountCode)) {
      datasAccount.set(accountCode, []);
    }

    datasAccount.get(accountCode)?.push(row);
  }

  for (const [distributionCode, rows] of datasAccount) {
    const fileName = `soa_${distributionCode}.parquet`;

    const buffer = writeSoaParquetToBuffer(rows);

    const result = await uploadParquetToStorage(fileName, buffer);

    if (!result.success) {
      throw new Error(`Failed to upload ${fileName}`);
    }

    console.log(
      `[Pipeline] Uploaded ${rows.length} rows for ${distributionCode} to ${result.key}`
    );
  }
}

import { join } from "node:path";

import type {
  IPartitionedFile,
  IStatementOfAccountModel,
} from "../../../module/utils/types";
import { writeSoaParquet } from "../../lib";

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

  const files: IPartitionedFile[] = [];

  for (const [distributionCode, rows] of datasAccount) {
    const fileName = `soa_${distributionCode}.parquet`;
    const localPath = join(process.cwd(), "src/data-pipeline/datas");
    const filePath = join(localPath, fileName);

    writeSoaParquet(rows, filePath);

    files.push({
      distributionCode,
      rowCount: rows.length,
      filePath,
    });

    console.log(`Wrote ${rows.length} rows for account ${distributionCode}`);
  }
}

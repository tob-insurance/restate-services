import { tableFromIPC } from "apache-arrow";
import { readParquet } from "../../infrastructure/parquet-wasm";
import { downloadParquetFromStorage } from "../../infrastructure/s3/pipeline-storage";
import type { IStatementOfAccountModel } from "../../types";

export async function readSoaParquet(
  accountCode: string,
  branchCode: string,
  referenceDate: Date
): Promise<IStatementOfAccountModel[]> {
  const raw = await downloadParquetFromStorage(
    accountCode,
    branchCode,
    referenceDate
  );
  if (!raw) {
    return [];
  }

  const wasmTable = readParquet(raw);
  const ipcStream = wasmTable.intoIPCStream();
  const arrowTable = tableFromIPC(ipcStream);

  const records: IStatementOfAccountModel[] = [];
  for (let i = 0; i < arrowTable.numRows; i++) {
    const record: Record<string, unknown> = {};
    for (const field of arrowTable.schema.fields) {
      const column = arrowTable.getChild(field.name);
      if (column) {
        record[field.name] = column.get(i);
      }
    }
    if (branchCode !== "ALL" && record.branch !== branchCode) {
      continue;
    }
    records.push(record as unknown as IStatementOfAccountModel);
  }

  return records;
}

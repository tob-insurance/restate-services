import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { downloadParquetFromStorage } from "../../infrastructure/pipeline-storage";
import type { IStatementOfAccountModel } from "../../types";

/**
 * Read Parquet file from Azure Blob Storage
 *
 * @param accountCode - Customer account code
 * @param branchCode - Branch code (optional, "ALL" for all)
 * @returns Array of IStatementOfAccountModel
 */
export async function readSoaParquet(
  accountCode: string,
  branchCode: string,
  referenceDate: Date
): Promise<IStatementOfAccountModel[]> {
  const buffer = await downloadParquetFromStorage(
    accountCode,
    branchCode,
    referenceDate
  );

  if (!buffer) {
    return [];
  }

  const table = readParquet(new Uint8Array(buffer));
  const rows = tableToArray(table) as unknown as IStatementOfAccountModel[];

  console.log(
    `[Azure Pipeline] Read ${rows.length} raw rows for ${accountCode}`
  );

  if (branchCode && branchCode !== "ALL") {
    const filteredBranch = rows.filter((row) => row.branch === branchCode);
    console.log(
      `[Azure Pipeline] Filtered by branch ${branchCode}: ${filteredBranch.length} rows`
    );
    return filteredBranch;
  }

  return rows;
}

/**
 * Convert parquet table to array of objects
 */
function tableToArray(
  table: ReturnType<typeof readParquet>
): Record<string, unknown>[] {
  const ipcStream = table.intoIPCStream();
  const arrowTable = tableFromIPC(ipcStream);
  return arrowTable
    .toArray()
    .map((row) => (row as { toJSON: () => Record<string, unknown> }).toJSON());
}

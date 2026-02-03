import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";

import type { IStatementOfAccountModel } from "../../../module/utils/types";

export function readSoaParquet(
  accountCode: string,
  branchCode: string
): IStatementOfAccountModel[] {
  const filePath = join(
    process.cwd(),
    "src/data-pipeline/datas",
    `soa_${accountCode}.parquet`
  );

  if (!existsSync(filePath)) {
    console.warn(`Parquet file not found: ${filePath}`);
    return [];
  }

  try {
    const buffer = readFileSync(filePath);
    const table = readParquet(new Uint8Array(buffer));
    const rows = tableToArray(table) as unknown as IStatementOfAccountModel[];

    console.log(`[Parquet] Read ${rows.length} raw rows from file`);

    if (branchCode && branchCode !== "ALL") {
      const filteredBranch = rows.filter((row) => row.branch === branchCode);
      console.log(
        `[Parquet] Filtered by branch ${branchCode}: ${filteredBranch.length} rows`
      );

      return filteredBranch;
    }

    return rows;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Parquet] Read error:", errorMessage);
    throw error;
  }
}

function tableToArray(
  table: ReturnType<typeof readParquet>
): Record<string, unknown>[] {
  const ipcStream = table.intoIPCStream();
  const arrowTable = tableFromIPC(ipcStream);
  return arrowTable
    .toArray()
    .map((row) => (row as { toJSON: () => Record<string, unknown> }).toJSON());
}

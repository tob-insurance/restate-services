import { writeFileSync } from "node:fs";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import {
  Compression,
  Table,
  WriterPropertiesBuilder,
  writeParquet,
} from "parquet-wasm";
import type { IStatementOfAccountModel } from "../../../module/utils/types";

export function writeSoaParquet(
  data: IStatementOfAccountModel[],
  outputPath: string
): void {
  // Convert to column-oriented format for Arrow
  const columns: Record<string, unknown[]> = {};

  if (data.length > 0) {
    // Initialize columns based on first row's keys
    for (const key of Object.keys(data[0])) {
      columns[key] = [];
    }

    // Populate columns
    for (const row of data) {
      for (const key of Object.keys(row)) {
        const value = row[key as keyof IStatementOfAccountModel];
        // Convert aging to number
        columns[key].push(
          key === "aging" ? Number.parseInt(value as string, 10) : value
        );
      }
    }
  }

  // Create Arrow Table in JS memory
  const arrowTable = tableFromArrays(columns);

  // Convert to parquet-wasm Table via IPC stream
  const wasmTable = Table.fromIPCStream(tableToIPC(arrowTable, "stream"));

  // Compression
  const writerProps = new WriterPropertiesBuilder()
    .setCompression(Compression.ZSTD)
    .build();

  // Write Parquet using parquet-wasm
  const buffer = writeParquet(wasmTable, writerProps);
  writeFileSync(outputPath, Buffer.from(buffer));
}

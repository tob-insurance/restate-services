import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initSync } from "parquet-wasm/esm";

const requireFromHere = createRequire(__filename);
const bundledWasmPath = join(__dirname, "parquet_wasm_bg.wasm");
const wasmPath = existsSync(bundledWasmPath)
  ? bundledWasmPath
  : requireFromHere.resolve("parquet-wasm/esm/parquet_wasm_bg.wasm");

initSync({ module: readFileSync(wasmPath) });

export {
  Compression,
  readParquet,
  Table,
  WriterPropertiesBuilder,
  writeParquet,
} from "parquet-wasm/esm";

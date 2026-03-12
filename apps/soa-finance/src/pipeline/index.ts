import { formatDuration } from "../utils";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import type { ISoaPipelineResult } from "./types";
import { writeToParquet } from "./write";

// Run complete SOA pipeline: Oracle → Transform → Parquet by account code → upload to Azure Blob

export async function generateSoaPipeline(
  asAtDate: Date
): Promise<ISoaPipelineResult> {
  const startTime = Date.now();
  console.log("[Pipeline] Starting SOA pipeline");

  // Create pipeline: Reader → Transformer
  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  // Write to Parquet
  await writeToParquet(transformedStream);

  const endTime = Date.now();
  const duration = formatDuration(endTime - startTime);

  console.log(`[Pipeline] Completed in ${duration}`);

  return {
    success: true,
    duration,
  };
}

import type { ISoaPipelineResult } from "../types";
import { formatDuration } from "../utils";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import { writeToParquet } from "./write";

// Run complete SOA pipeline: Oracle → Transform → Parquet by account code → upload to S3

export async function generateSoaPipeline(
  asAtDate: Date,
  testMode?: boolean
): Promise<ISoaPipelineResult> {
  const startTime = Date.now();
  console.log("Starting SOA pipeline");

  // Create pipeline: Reader → Transformer
  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  // Write to Parquet
  await writeToParquet(transformedStream, testMode);

  const endTime = Date.now();
  const duration = formatDuration(endTime - startTime);

  console.log(`Pipeline completed in ${duration}`);

  return {
    success: true,
    duration,
  };
}

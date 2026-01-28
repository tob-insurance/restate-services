import { formatDuration } from "../../module/utils/formatter";
import type { ISoaPipelineResult } from "../../module/utils/types/pipeline";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import { writeToParquet } from "./write";

// Run complete SOA pipeline: Oracle → Transform → Parquet by account code → save to local file

export async function generateSoaPipeline(
  asAtDate: Date
): Promise<ISoaPipelineResult> {
  const startTime = Date.now();
  console.log("Starting SOA pipeline");

  // Create pipeline: Reader → Transformer
  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  // Write to Parquet
  await writeToParquet(transformedStream);

  const endTime = Date.now();
  const duration = formatDuration(endTime - startTime);

  console.log(`Pipeline completed in ${duration}`);

  return {
    success: true,
    duration,
  };
}

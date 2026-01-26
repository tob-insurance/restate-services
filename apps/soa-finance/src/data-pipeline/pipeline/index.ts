import { formatDuration } from "../../module/utils/formater";
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
  const oracleStream = streamSoaData(asAtDate); // get all data from package
  const transformedStream = transformSoaStream(oracleStream); // transform data to SOA model

  // Write to Parquet
  await writeToParquet(transformedStream); // write to parquet file by distribution code

  const endTime = Date.now();
  const duration = formatDuration(endTime - startTime);

  console.log(`Pipeline completed in ${duration}`);

  return {
    success: true,
    duration,
  };
}

import { isDevelopment } from "../constants";
import type { IStatementOfAccountModel } from "../types";
import { generateDevData } from "./dev-data";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import type { ISoaPipelineResult } from "./types";
import { writeToParquet } from "./write";

// Run complete SOA pipeline: Oracle → Transform → Parquet by account code → upload to Azure Blob

export async function generateSoaPipeline(
  asAtDate: Date
): Promise<ISoaPipelineResult> {
  console.log("[Pipeline] Starting SOA pipeline");

  if (isDevelopment()) {
    console.log("[Pipeline] DEV MODE: using synthetic test data");
    const testData = generateDevData();
    const testStream: AsyncIterable<IStatementOfAccountModel> = {
      [Symbol.asyncIterator]() {
        let i = -1;
        return {
          next: () =>
            Promise.resolve().then(
              (): IteratorResult<IStatementOfAccountModel> => {
                i += 1;
                return i < testData.length
                  ? { value: testData[i], done: false as const }
                  : { value: undefined, done: true as const };
              }
            ),
        };
      },
    };
    await writeToParquet(testStream, asAtDate);
    console.log("[Pipeline] Dev pipeline completed");
    return { success: true };
  }

  // Create pipeline: Reader → Transformer
  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  // Write to Parquet
  await writeToParquet(transformedStream, asAtDate);

  console.log("[Pipeline] Completed");

  return {
    success: true,
  };
}

export async function collectPipelineData(
  asAtDate: Date
): Promise<Map<string, IStatementOfAccountModel[]>> {
  console.log("[Pipeline] Collecting data from Oracle");

  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  const datasAccount = new Map<string, IStatementOfAccountModel[]>();

  for await (const row of transformedStream) {
    const accountCode = row.distributionCode;

    if (!datasAccount.has(accountCode)) {
      datasAccount.set(accountCode, []);
    }

    datasAccount.get(accountCode)?.push(row);
  }

  console.log(`[Pipeline] Collected ${datasAccount.size} accounts`);

  return datasAccount;
}

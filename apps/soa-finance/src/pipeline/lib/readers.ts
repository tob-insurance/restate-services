import { GetObjectCommand } from "@aws-sdk/client-s3";
import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { getS3PathPrefix } from "../../constants";
import {
  getStorageServiceClient,
  storageServiceConfig,
} from "../../infrastructure/s3";
import type { IStatementOfAccountModel } from "../../types";

/**
 * Membaca file Parquet dari S3
 *
 * @param accountCode - Kode akun customer
 * @param branchCode - Kode cabang (opsional, "ALL" untuk semua)
 * @returns Array of IStatementOfAccountModel
 */
export async function readSoaParquet(
  accountCode: string,
  branchCode: string
): Promise<IStatementOfAccountModel[]> {
  const s3Client = getStorageServiceClient();
  const bucketName = storageServiceConfig.bucketName;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const environment = getS3PathPrefix();
  const s3Key = `${environment}/${year}-${month}/soa_${accountCode}.parquet`;

  try {
    console.log(`[S3] Fetching parquet from: s3://${bucketName}/${s3Key}`);

    // Download file dari S3
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      console.warn(`[S3] File not found or empty: ${s3Key}`);
      return [];
    }

    // Convert stream ke buffer
    const bodyContents = await streamToBuffer(response.Body);

    // Parse parquet menggunakan parquet-wasm
    const table = readParquet(new Uint8Array(bodyContents));
    const rows = tableToArray(table) as unknown as IStatementOfAccountModel[];

    console.log(
      `[S3 Parquet] Read ${rows.length} raw rows from S3 (${environment})`
    );

    // Filter by branch jika diperlukan
    if (branchCode && branchCode !== "ALL") {
      const filteredBranch = rows.filter((row) => row.branch === branchCode);
      console.log(
        `[S3 Parquet] Filtered by branch ${branchCode}: ${filteredBranch.length} rows`
      );
      return filteredBranch;
    }

    return rows;
  } catch (error: unknown) {
    // Handle file not found
    if ((error as { name?: string }).name === "NoSuchKey") {
      console.warn(`[S3] Parquet file not found: ${s3Key}`);
      return [];
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[S3 Parquet] Read error:", errorMessage);
    throw error;
  }
}

/**
 * Convert AWS SDK stream ke Buffer
 */
async function streamToBuffer(
  stream: NodeJS.ReadableStream | ReadableStream | Blob
): Promise<Buffer> {
  // Jika stream adalah Blob (browser/node 18+)
  if (stream instanceof Blob) {
    const arrayBuffer = await stream.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Jika stream adalah ReadableStream (web streams)
  if ("getReader" in stream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  // Fallback untuk Node.js streams
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (stream as NodeJS.ReadableStream).on("data", (chunk) =>
      chunks.push(Buffer.from(chunk))
    );
    (stream as NodeJS.ReadableStream).on("end", () =>
      resolve(Buffer.concat(chunks))
    );
    (stream as NodeJS.ReadableStream).on("error", reject);
  });
}

/**
 * Convert parquet table ke array of objects
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

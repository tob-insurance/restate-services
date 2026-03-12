import { getPipelinePathPrefix } from "../constants";
import { getContainerClient } from "./azure/blob-client";

type UploadResult = {
  key: string;
  success: boolean;
};

function generatePipelineBlobPath(fileName: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = getPipelinePathPrefix();

  return `${prefix}/${year}-${month}/${fileName}`;
}

export async function uploadParquetToStorage(
  fileName: string,
  buffer: Buffer
): Promise<UploadResult> {
  const container = getContainerClient();
  const blobPath = generatePipelineBlobPath(fileName);
  const blockBlobClient = container.getBlockBlobClient(blobPath);

  try {
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: "application/octet-stream" },
    });

    console.log(`[Azure Pipeline] Uploaded ${blobPath} successfully`);
    return { key: blobPath, success: true };
  } catch (error) {
    console.error(`[Azure Pipeline] Upload failed: ${error}`);
    throw error;
  }
}

export async function downloadParquetFromStorage(
  accountCode: string,
  _branchCode: string
): Promise<Buffer | null> {
  const container = getContainerClient();
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const prefix = getPipelinePathPrefix();
  const blobPath = `${prefix}/${year}-${month}/soa_${accountCode}.parquet`;

  try {
    console.log(`[Azure Pipeline] Fetching parquet from: ${blobPath}`);

    const blockBlobClient = container.getBlockBlobClient(blobPath);
    const response = await blockBlobClient.download(0);

    const chunks: Buffer[] = [];
    const streamBody = response.readableStreamBody;
    if (!streamBody) {
      console.warn(`[Azure Pipeline] File not found or empty: ${blobPath}`);
      return null;
    }

    for await (const chunk of streamBody) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      console.warn(`[Azure Pipeline] Parquet file not found: ${blobPath}`);
      return null;
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Azure Pipeline] Read error: ${errorMessage}`);
    throw error;
  }
}

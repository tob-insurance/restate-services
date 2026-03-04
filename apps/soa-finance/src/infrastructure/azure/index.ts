import { Readable } from "node:stream";
import { getContainerClient } from "./blob-client";

type StorageFileData = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
};

type UploadResult = {
  url: string;
  blobName: string;
  success: boolean;
};

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB
const MAX_CONCURRENCY = 4;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function generateBlobPath(
  customerCode: string,
  type: "excel" | "pdf",
  fileName: string
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return `SOA/${year}-${month}/${customerCode}/${type}/${fileName}`;
}

export async function uploadFile(
  fileData: StorageFileData,
  customerCode: string,
  type: "excel" | "pdf"
): Promise<UploadResult> {
  const container = getContainerClient();
  const blobName = generateBlobPath(customerCode, type, fileData.fileName);
  const blockBlobClient = container.getBlockBlobClient(blobName);

  const fileSize = fileData.bytes.length;
  const isLargeFile = fileSize > LARGE_FILE_THRESHOLD;

  try {
    if (isLargeFile) {
      console.log(
        `[Azure] Large file detected (${(fileSize / (1024 * 1024)).toFixed(2)}MB), using chunked upload...`
      );
      const stream = Readable.from(fileData.bytes);

      await blockBlobClient.uploadStream(stream, BLOCK_SIZE, MAX_CONCURRENCY, {
        blobHTTPHeaders: { blobContentType: fileData.contentType },
        abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        onProgress: (progress) => {
          const percent = ((progress.loadedBytes / fileSize) * 100).toFixed(1);
          console.log(`[Azure] Upload progress: ${percent}%`);
        },
      });
    } else {
      await blockBlobClient.uploadData(fileData.bytes, {
        blobHTTPHeaders: { blobContentType: fileData.contentType },
        abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    }

    console.log(`[Azure] Uploaded ${blobName} successfully`);
    return { url: blockBlobClient.url, blobName, success: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Azure] Failed to upload ${blobName}: ${errorMessage}`);
    throw error;
  }
}

export async function downloadFile(blobName: string): Promise<Buffer> {
  const container = getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);
  const response = await blockBlobClient.download(0);

  const chunks: Buffer[] = [];
  const streamBody = response.readableStreamBody;
  if (streamBody) {
    for await (const chunk of streamBody) {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks);
}

export async function deleteFile(blobName: string): Promise<boolean> {
  const container = getContainerClient();

  try {
    await container.getBlockBlobClient(blobName).deleteIfExists();
    return true;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Azure] Failed to delete ${blobName}: ${errorMessage}`);
    return false;
  }
}

export async function downloadSoaFiles(
  customerCode: string,
  excelFileName: string,
  pdfFileName: string
): Promise<{
  excelBuffer: Buffer;
  pdfBuffer: Buffer;
  excelName: string;
  pdfName: string;
}> {
  const excelBlobName = generateBlobPath(customerCode, "excel", excelFileName);
  const pdfBlobName = generateBlobPath(customerCode, "pdf", pdfFileName);

  console.log(`[Azure] Downloading Excel: ${excelBlobName}`);
  console.log(`[Azure] Downloading PDF: ${pdfBlobName}`);

  const [excelBuffer, pdfBuffer] = await Promise.all([
    downloadFile(excelBlobName),
    downloadFile(pdfBlobName),
  ]);

  console.log(`[Azure] Downloaded Excel: ${excelBuffer.length} bytes`);
  console.log(`[Azure] Downloaded PDF: ${pdfBuffer.length} bytes`);

  return {
    excelBuffer,
    pdfBuffer,
    excelName: excelFileName,
    pdfName: pdfFileName,
  };
}

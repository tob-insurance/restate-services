import { Readable } from "node:stream";
import { RestError } from "@azure/storage-blob";
import { AZURE_UPLOAD } from "../../constants";
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
  const isLargeFile = fileSize > AZURE_UPLOAD.LARGE_FILE_THRESHOLD;

  try {
    if (isLargeFile) {
      console.log(
        `[Azure] Large file detected (${(fileSize / (1024 * 1024)).toFixed(2)}MB), using chunked upload...`
      );
      const stream = Readable.from(fileData.bytes);

      await blockBlobClient.uploadStream(
        stream,
        AZURE_UPLOAD.BLOCK_SIZE,
        AZURE_UPLOAD.MAX_CONCURRENCY,
        {
          blobHTTPHeaders: { blobContentType: fileData.contentType },
          abortSignal: AbortSignal.timeout(AZURE_UPLOAD.UPLOAD_TIMEOUT_MS),
          onProgress: (progress) => {
            const percent = ((progress.loadedBytes / fileSize) * 100).toFixed(
              1
            );
            console.log(`[Azure] Upload progress: ${percent}%`);
          },
        }
      );
    } else {
      await blockBlobClient.uploadData(fileData.bytes, {
        blobHTTPHeaders: { blobContentType: fileData.contentType },
        abortSignal: AbortSignal.timeout(AZURE_UPLOAD.UPLOAD_TIMEOUT_MS),
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

export async function downloadFile(blobName: string): Promise<Buffer | null> {
  const container = getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);
  try {
    const response = await blockBlobClient.download(0);
    const chunks: Buffer[] = [];
    const streamBody = response.readableStreamBody;
    if (streamBody) {
      for await (const chunk of streamBody) {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    if (error instanceof RestError && error.statusCode === 404) {
      console.warn(`[Azure] File not found: ${blobName}`);
      return null;
    }
    throw error;
  }
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

  if (!(excelBuffer && pdfBuffer)) {
    throw new Error(
      `Missing files for customer ${customerCode}: excel=${!!excelBuffer}, pdf=${!!pdfBuffer}`
    );
  }

  console.log(`[Azure] Downloaded Excel: ${excelBuffer.length} bytes`);
  console.log(`[Azure] Downloaded PDF: ${pdfBuffer.length} bytes`);

  return {
    excelBuffer,
    pdfBuffer,
    excelName: excelFileName,
    pdfName: pdfFileName,
  };
}

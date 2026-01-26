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

  try {
    await blockBlobClient.uploadData(fileData.bytes, {
      blobHTTPHeaders: {
        blobContentType: fileData.contentType,
      },
    });

    console.log(`File uploaded ${blobName} successfully`);
    return { url: blockBlobClient.url, blobName, success: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to upload file ${blobName}: ${errorMessage}`);
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
    console.error(`Failed to delete file ${blobName}: ${errorMessage}`);
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

  console.log(`Downloading Excel from: ${excelBlobName}`);
  console.log(`Downloading PDF from: ${pdfBlobName}`);

  const [excelBuffer, pdfBuffer] = await Promise.all([
    downloadFile(excelBlobName),
    downloadFile(pdfBlobName),
  ]);

  console.log(`Downloaded Excel: ${excelBuffer.length} bytes`);
  console.log(`Downloaded PDF: ${pdfBuffer.length} bytes`);

  return {
    excelBuffer,
    pdfBuffer,
    excelName: excelFileName,
    pdfName: pdfFileName,
  };
}

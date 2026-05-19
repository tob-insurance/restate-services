import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getBucketName, getS3Client } from "./s3-client";

type StorageFileData = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
};

type UploadResult = {
  url: string;
  key: string;
  success: boolean;
};

function generateStoragePath(
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
  const client = getS3Client();
  const bucket = getBucketName();
  const key = generateStoragePath(customerCode, type, fileData.fileName);

  const fileSize = fileData.bytes.length;
  console.log(
    `[S3] Uploading ${type} (${(fileSize / 1024).toFixed(1)}KB) to s3://${bucket}/${key}`
  );

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileData.bytes,
        ContentType: fileData.contentType,
      })
    );

    const url = `s3://${bucket}/${key}`;
    console.log(`[S3] Uploaded ${key} successfully`);
    return { url, key, success: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[S3] Failed to upload ${key}: ${errorMessage}`);
    throw error;
  }
}

export async function downloadFile(key: string): Promise<Buffer | null> {
  const client = getS3Client();
  const bucket = getBucketName();

  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const chunks: Buffer[] = [];
    const stream = response.Body;
    if (stream) {
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    const s3Error = error as { name?: string };
    if (s3Error.name === "NoSuchKey") {
      console.warn(`[S3] File not found: ${key}`);
      return null;
    }
    throw error;
  }
}

export async function deleteFile(key: string): Promise<boolean> {
  const client = getS3Client();
  const bucket = getBucketName();

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[S3] Failed to delete ${key}: ${errorMessage}`);
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
  const excelKey = generateStoragePath(customerCode, "excel", excelFileName);
  const pdfKey = generateStoragePath(customerCode, "pdf", pdfFileName);

  console.log(`[S3] Downloading Excel: ${excelKey}`);
  console.log(`[S3] Downloading PDF: ${pdfKey}`);

  const [excelBuffer, pdfBuffer] = await Promise.all([
    downloadFile(excelKey),
    downloadFile(pdfKey),
  ]);

  if (!(excelBuffer && pdfBuffer)) {
    throw new Error(
      `Missing files for customer ${customerCode}: excel=${!!excelBuffer}, pdf=${!!pdfBuffer}`
    );
  }

  console.log(`[S3] Downloaded Excel: ${excelBuffer.length} bytes`);
  console.log(`[S3] Downloaded PDF: ${pdfBuffer.length} bytes`);

  return {
    excelBuffer,
    pdfBuffer,
    excelName: excelFileName,
    pdfName: pdfFileName,
  };
}

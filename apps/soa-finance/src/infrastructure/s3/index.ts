import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { FileData } from "../../types/soa.type.js";
import logger from "../../utils/logger.js";
import { getBucketName, getS3Client } from "./s3-client.js";

interface UploadResult {
  key: string;
  success: boolean;
  url: string;
}

function generateStoragePath(
  customerCode: string,
  type: "excel" | "pdf",
  fileName: string,
  date: Date
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `SOA/${year}-${month}/${customerCode}/${type}/${fileName}`;
}

export async function uploadFile(
  fileData: FileData,
  customerCode: string,
  type: "excel" | "pdf",
  date: Date
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = getBucketName();
  const key = generateStoragePath(customerCode, type, fileData.fileName, date);

  const fileSize = fileData.bytes.length;
  logger.info(
    {
      bucket,
      component: "S3",
      fileSizeKb: (fileSize / 1024).toFixed(1),
      key,
      type,
    },
    "Uploading file to S3"
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
    logger.info({ component: "S3", key }, "Uploaded file successfully");
    return { url, key, success: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { component: "S3", err: error, errorMessage, key },
      "Failed to upload file"
    );
    throw error;
  }
}

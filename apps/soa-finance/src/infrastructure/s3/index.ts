import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { BufferFileData, FileData } from "../../types/soa.type.js";
import { isBufferFileData } from "../../types/soa.type.js";
import logger from "../../utils/logger.js";
import { getBucketName, getS3Client } from "./s3-client.js";

interface UploadResult {
  key: string;
  success: boolean;
  url: string;
}

function generateStoragePath(fileName: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `CollectionLetters/${year}-${month}/${fileName}`;
}

export async function uploadFile(
  fileData: FileData,
  date: Date
): Promise<UploadResult> {
  if (!isBufferFileData(fileData)) {
    throw new Error("uploadFile requires BufferFileData with bytes");
  }
  return await uploadBufferFile(fileData, date);
}

async function uploadBufferFile(
  fileData: BufferFileData,
  date: Date
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = getBucketName();
  const key = generateStoragePath(fileData.fileName, date);

  if (!fileData.bytes) {
    throw new Error("uploadFile requires fileData.bytes to be set");
  }
  const fileSize = fileData.bytes.length;
  logger.info(
    {
      bucket,
      component: "S3",
      fileSizeKb: (fileSize / 1024).toFixed(1),
      key,
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

export async function downloadFile(urlOrKey: string): Promise<FileData> {
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.info(
        { component: "S3", attempt, delayMs, key: urlOrKey },
        "Retrying S3 download after delay"
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      return await downloadFileAttempt(urlOrKey);
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) {
        throw error;
      }
      logger.warn(
        { component: "S3", attempt, key: urlOrKey, err: error },
        "S3 download attempt failed, may retry"
      );
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error(`Failed to download ${urlOrKey} after ${maxRetries} retries`);
}

async function downloadFileAttempt(urlOrKey: string): Promise<FileData> {
  // If it's an object URL (starts with https://), fetch it directly
  if (urlOrKey.startsWith("https://")) {
    logger.info(
      { component: "S3", url: urlOrKey },
      "Downloading file from object URL"
    );

    const response = await fetch(urlOrKey);
    if (!response.ok) {
      throw new Error(
        `Failed to download from URL: ${response.status} ${response.statusText}`
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const fileName = new URL(urlOrKey).pathname.split("/").pop() || "download";

    logger.info({ component: "S3", fileName }, "Downloaded file successfully");
    return { bytes, contentType, fileName };
  }

  // Otherwise, treat as S3 key and use SDK
  const client = getS3Client();
  const bucket = getBucketName();

  logger.info(
    { bucket, component: "S3", key: urlOrKey },
    "Downloading file from S3"
  );

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: urlOrKey,
    })
  );

  if (!response.Body) {
    throw new Error(`Empty response body for key: ${urlOrKey}`);
  }

  const bytes = Buffer.from(await response.Body.transformToByteArray());
  const contentType = response.ContentType || "application/octet-stream";
  const fileName = urlOrKey.split("/").pop() || "download";

  logger.info(
    { component: "S3", key: urlOrKey },
    "Downloaded file successfully"
  );
  return { bytes, contentType, fileName };
}

export function getObjectUrl(key: string): string {
  const bucket = getBucketName();
  const region = process.env.AWS_REGION || "ap-southeast-3";
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  logger.info({ component: "S3", key }, "Generated object URL");

  return url;
}

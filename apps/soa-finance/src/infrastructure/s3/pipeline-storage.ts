import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getBucketName, getS3Client } from "./s3-client";

type UploadResult = {
  key: string;
  success: boolean;
};

function getMonthPartition(referenceDate: Date): string {
  const year = referenceDate.getUTCFullYear();
  const month = String(referenceDate.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

export function buildUploadBlobPath(
  fileName: string,
  referenceDate: Date
): string {
  const prefix = process.env.S3_PIPELINE_PREFIX || "parquet";
  const env = process.env.APP_ENV || "development";

  return `${prefix}/${env}/${getMonthPartition(referenceDate)}/${fileName}`;
}

export function buildDownloadBlobPath(
  accountCode: string,
  referenceDate: Date
): string {
  const prefix = process.env.S3_PIPELINE_PREFIX || "parquet";
  const env = process.env.APP_ENV || "development";

  return `${prefix}/${env}/${getMonthPartition(referenceDate)}/soa_${accountCode}.parquet`;
}

export async function uploadParquetToStorage(
  fileName: string,
  buffer: Buffer,
  referenceDate: Date
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = getBucketName();
  const key = buildUploadBlobPath(fileName, referenceDate);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: "application/octet-stream",
      })
    );

    console.log(`[Pipeline] Uploaded parquet to s3://${bucket}/${key}`);
    return { key, success: true };
  } catch (error: unknown) {
    console.error(`[Pipeline] Upload failed: ${error}`);
    throw error;
  }
}

export async function downloadParquetFromStorage(
  accountCode: string,
  _branchCode: string,
  referenceDate: Date
): Promise<Buffer | null> {
  const client = getS3Client();
  const bucket = getBucketName();
  const key = buildDownloadBlobPath(accountCode, referenceDate);

  try {
    console.log(`[Pipeline] Fetching parquet from: s3://${bucket}/${key}`);

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const chunks: Buffer[] = [];
    const streamBody = response.Body;
    if (!streamBody) {
      console.warn(`[Pipeline] File not found or empty: s3://${bucket}/${key}`);
      return null;
    }

    for await (const chunk of streamBody as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  } catch (error: unknown) {
    const s3Error = error as { name?: string };
    if (s3Error.name === "NoSuchKey") {
      console.warn(`[Pipeline] Parquet file not found: s3://${bucket}/${key}`);
      return null;
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Pipeline] Read error: ${errorMessage}`);
    throw error;
  }
}

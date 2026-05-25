import { S3Client } from "@aws-sdk/client-s3";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
if (!AWS_REGION) {
  throw new Error("AWS_REGION environment variable is required for S3 client");
}
if (!S3_BUCKET) {
  throw new Error("S3_BUCKET environment variable is required");
}

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: AWS_REGION,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  return s3Client;
}

export function getBucketName(): string {
  return S3_BUCKET;
}

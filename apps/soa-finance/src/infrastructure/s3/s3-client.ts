import { S3Client } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const awsRegion = process.env.AWS_REGION;
  if (!awsRegion) {
    throw new Error(
      "AWS_REGION environment variable is required for S3 client"
    );
  }

  s3Client = new S3Client({
    region: awsRegion,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  return s3Client;
}

export function getBucketName(): string {
  const s3Bucket = process.env.S3_BUCKET;
  if (!s3Bucket) {
    throw new Error("S3_BUCKET environment variable is required");
  }

  return s3Bucket;
}

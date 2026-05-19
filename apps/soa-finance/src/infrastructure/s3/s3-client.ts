import { S3Client } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: process.env.AWS_REGION || "ap-southeast-3",
  });

  return s3Client;
}

export function getBucketName(): string {
  return process.env.S3_BUCKET || "soa-finance-1778060263";
}

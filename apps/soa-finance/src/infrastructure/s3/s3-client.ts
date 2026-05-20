import { S3Client } from "@aws-sdk/client-s3";

const AWS_REGION = process.env.AWS_REGION || "ap-southeast-3";
const S3_BUCKET = process.env.S3_BUCKET || "soa-finance-default";

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: AWS_REGION,
  });

  return s3Client;
}

export function getBucketName(): string {
  return S3_BUCKET;
}

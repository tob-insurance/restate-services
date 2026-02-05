import { S3Client } from "@aws-sdk/client-s3";
import { storageServiceConfig } from "./s3-config";

let storageServiceClient: S3Client | null = null;

export const getStorageServiceClient = (): S3Client => {
  if (!storageServiceClient) {
    storageServiceClient = new S3Client(storageServiceConfig);
  }
  return storageServiceClient;
};

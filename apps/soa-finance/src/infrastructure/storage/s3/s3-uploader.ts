import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getStorageServiceClient } from "./s3-client";
import { storageServiceConfig } from "./s3-config";

type IUploadResult = {
  key: string;
  success: boolean;
};

function generateStorageSreviceKey(
  fileName: string,
  testMode?: boolean
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const baseProdPath = "production";
  const baseDevPath = "development";

  if (testMode === true) {
    return `${baseDevPath}/${year}-${month}/${fileName}`;
  }

  return `${baseProdPath}/${year}-${month}/${fileName}`;
}

export async function uploadParquetToS3(
  fileName: string,
  buffer: Buffer,
  testMode?: boolean
): Promise<IUploadResult> {
  const storageServiceClient = getStorageServiceClient();
  const storageServiceKey = generateStorageSreviceKey(fileName, testMode);

  try {
    await storageServiceClient.send(
      new PutObjectCommand({
        Bucket: storageServiceConfig.bucketName,
        Key: storageServiceKey,
        Body: buffer,
      })
    );

    return { key: storageServiceKey, success: true };
  } catch (error) {
    console.error(`[S3] Upload failed: ${error}`);
    throw error;
  }
}

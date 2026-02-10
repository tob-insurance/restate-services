import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const storageServiceConfig = {
  bucketName: process.env.S3_BUCKET_NAME,
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

let storageServiceClient: S3Client | null = null;

export const getStorageServiceClient = (): S3Client => {
  if (!storageServiceClient) {
    storageServiceClient = new S3Client(storageServiceConfig);
  }
  return storageServiceClient;
};

type IUploadResult = {
  key: string;
  success: boolean;
};

function generateStorageServiceKey(
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
  const client = getStorageServiceClient();
  const storageServiceKey = generateStorageServiceKey(fileName, testMode);

  try {
    await client.send(
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

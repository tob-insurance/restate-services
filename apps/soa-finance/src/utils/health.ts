import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getBucketName, getS3Client } from "../infrastructure/s3/s3-client";
import logger from "./logger";

export async function checkS3BucketAccess(): Promise<boolean> {
  try {
    const client = getS3Client();
    const bucket = getBucketName();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    logger.warn(
      { component: "HealthCheck", bucket: getBucketName(), err: error },
      "S3 bucket check failed — continuing"
    );
    return false;
  }
}

export async function checkGotenbergConnectivity(): Promise<boolean> {
  try {
    const url = process.env.GOTENBERG_URL || "http://localhost:3000";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch (error) {
    logger.warn(
      { component: "HealthCheck", err: error },
      "Gotenberg connectivity check failed — continuing"
    );
    return false;
  }
}

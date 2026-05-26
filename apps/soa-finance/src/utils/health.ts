import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getBucketName, getS3Client } from "../infrastructure/s3/s3-client.js";
import logger from "./logger.js";

export interface HealthCheckResult {
  error?: string;
  latencyMs: number;
  ok: boolean;
}

export async function checkS3BucketAccess(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const client = getS3Client();
    const bucket = getBucketName();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      { component: "HealthCheck", bucket: getBucketName(), err: error },
      "S3 check failed"
    );
    return { ok: false, error: message, latencyMs: Date.now() - start };
  }
}

export async function checkGotenbergConnectivity(): Promise<HealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = process.env.GOTENBERG_URL || "http://localhost:3000";
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return { ok: response.ok, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      { component: "HealthCheck", err: error },
      "Gotenberg connectivity check failed"
    );
    return { ok: false, error: message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

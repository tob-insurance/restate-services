import { join } from "node:path";

function resolveAssetsDir(): string {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return join(import.meta.dirname, "assets");
  }
  return join(import.meta.dirname, "../assets");
}

export const ASSETS_DIR = resolveAssetsDir();

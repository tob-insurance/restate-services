import { join } from "node:path";

function resolveAssetsDir(): string {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return join(__dirname, "assets");
  }
  return join(__dirname, "../assets");
}

export const ASSETS_DIR = resolveAssetsDir();

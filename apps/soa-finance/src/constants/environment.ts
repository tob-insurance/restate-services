type AppEnvironment = "development" | "production";

const TRAILING_SLASHES = /\/+$/;

export function getAppEnvironment(): AppEnvironment {
  const env = process.env.APP_ENV;
  if (env === "development") {
    return "development";
  }
  return "production";
}

export function isDevelopment(): boolean {
  return getAppEnvironment() === "development";
}

export function getPipelinePathPrefix(): string {
  const raw = process.env.AZURE_STORAGE_PIPELINE_PREFIX || "parquet";
  const prefix = raw.replace(TRAILING_SLASHES, "");
  return `${prefix}/${getAppEnvironment()}`;
}

export function getTestEmailRecipient(): string {
  return process.env.TEST_EMAIL_RECIPIENT || "";
}

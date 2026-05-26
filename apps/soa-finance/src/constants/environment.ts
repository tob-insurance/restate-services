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
  const raw = process.env.S3_PIPELINE_PREFIX || "parquet";
  const prefix = raw.replace(TRAILING_SLASHES, "");
  return `${prefix}/${getAppEnvironment()}`;
}

export function getTestEmailRecipient(): string {
  return process.env.TEST_EMAIL_RECIPIENT || "";
}

export function parseEnvInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (!raw) {
    return defaultVal;
  }
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

export function parseEnvList(key: string): string[] | null {
  const raw = process.env[key];
  if (!raw) {
    return null;
  }
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

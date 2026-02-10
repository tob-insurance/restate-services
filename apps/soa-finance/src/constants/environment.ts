type AppEnvironment = "development" | "production";

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

export function getS3PathPrefix(): string {
  return getAppEnvironment();
}

export function getTestEmailRecipient(): string {
  return process.env.TEST_EMAIL_RECIPIENT || "";
}

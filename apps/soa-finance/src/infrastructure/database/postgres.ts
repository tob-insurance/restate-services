import {
  createPostgresClient,
  isDataIntegrityError,
  type PostgresClient,
} from "@restate-tob/postgres";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../constants/environment.js";
import logger from "../../utils/logger.js";

let pgClient: PostgresClient | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return url;
}

function logDevModeWarning(connectionString: string): void {
  if (!isDevelopment()) {
    return;
  }

  try {
    const url = new URL(connectionString);
    logger.warn(
      { component: "DEV MODE", host: url.hostname, port: url.port || "5432" },
      "⚠️  Connecting to PostgreSQL. Double-check this is NOT your production database before proceeding."
    );
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    logger.warn(
      { component: "DEV MODE" },
      "⚠️  Connecting to PostgreSQL (raw connection string). Double-check this is NOT your production database before proceeding."
    );
  }
}

export function getPostgresClient(): PostgresClient {
  if (!pgClient) {
    const connectionString = getDatabaseUrl();
    logDevModeWarning(connectionString);
    pgClient = createPostgresClient({ connectionString });
  }
  if (!pgClient) {
    throw new Error("Failed to initialize PostgreSQL client");
  }
  return pgClient;
}

export function initPostgresClient(): void {
  getPostgresClient();
}

export function testPostgresConnection(): Promise<boolean> {
  return getPostgresClient().testConnection();
}

export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) {
  try {
    const result = await getPostgresClient().executeQuery<T>(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    const pgError = error as { code?: string; message?: string };
    if (isDataIntegrityError(pgError.code)) {
      throw new TerminalError(
        `Database integrity error: ${pgError.message ?? "Unknown constraint violation"}`
      );
    }
    throw error;
  }
}

export async function closeConnections(): Promise<void> {
  if (pgClient) {
    await pgClient.close();
    pgClient = null;
  }
}

import {
  closeGlobalPostgresClient,
  getGlobalPostgresClient,
  isDataIntegrityError,
  type PostgresClient,
} from "@restate-tob/postgres";
import { TerminalError } from "@restatedev/restate-sdk";
import { isDevelopment } from "../../constants/environment.js";
import logger from "../../utils/logger.js";

let devWarningLogged = false;

function logDevModeWarning(connectionString: string): void {
  if (!isDevelopment() || devWarningLogged) {
    return;
  }
  devWarningLogged = true;

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
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  logDevModeWarning(connectionString);
  return getGlobalPostgresClient({ connectionString });
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
  } catch (error: unknown) {
    const pgError = error as { code?: string; message?: string };
    if (isDataIntegrityError(pgError.code)) {
      throw new TerminalError(
        `Database integrity error: ${pgError.message ?? "Unknown constraint violation"}`
      );
    }
    throw error;
  }
}

export function closeConnections(): Promise<void> {
  return closeGlobalPostgresClient();
}

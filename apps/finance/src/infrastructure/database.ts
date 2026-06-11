import {
  closeGlobalPostgresClient,
  getGlobalPostgresClient,
  isDataIntegrityError,
  type PostgresClient,
} from "@restate-tob/postgres";
import { TerminalError } from "@restatedev/restate-sdk";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function getPostgresClient(): PostgresClient {
  return getGlobalPostgresClient({
    poolOverrides: {
      ssl: { rejectUnauthorized: false },
      query_timeout: SIX_HOURS_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
  });
}

export function initPostgresClient(): void {
  getPostgresClient();
}

export function testConnection(): Promise<boolean> {
  return getPostgresClient().testConnection();
}

export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
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

import {
  closeGlobalPostgresClient,
  getGlobalPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";

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

export function closeConnections(): Promise<void> {
  return closeGlobalPostgresClient();
}

import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

let postgresClient: PostgresClient | null = null;

function getOracleInstantClientPath(): string | undefined {
  return process.env.ORACLE_INSTANT_CLIENT_PATH ?? process.env.ORACLE_LIB_DIR;
}

export function getPostgresClient(): PostgresClient {
  if (postgresClient) {
    return postgresClient;
  }

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL environment variable is required");
  }

  postgresClient = createPostgresClient({
    connectionString,
    ssl: { rejectUnauthorized: false },
    query_timeout: SIX_HOURS_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  return postgresClient;
}

export function initPostgresClient(): void {
  getPostgresClient();
}

export function testConnection(): Promise<boolean> {
  return getPostgresClient().testConnection();
}

export async function closeConnections(): Promise<void> {
  await postgresClient?.close();
  postgresClient = null;
}

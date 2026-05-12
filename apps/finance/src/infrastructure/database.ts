import {
  createPostgresClient,
  type PostgresClient,
} from "@restate-tob/postgres";

let postgresClient: PostgresClient | null = null;
let geniusClient: PostgresClient | null = null;

export function getPostgresClient(): PostgresClient {
  if (!postgresClient) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL environment variable is required");
    }
    postgresClient = createPostgresClient({ connectionString });
  }
  return postgresClient;
}

export function getGeniusClient(): PostgresClient {
  if (!geniusClient) {
    const connectionString = process.env.GENIUS_URL;
    if (!connectionString) {
      throw new Error("GENIUS_URL environment variable is required");
    }
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    geniusClient = createPostgresClient({
      connectionString,
      ssl: { rejectUnauthorized: false },
      query_timeout: SIX_HOURS_MS,
      statement_timeout: SIX_HOURS_MS,
    });
  }
  return geniusClient;
}

/**
 * Initializes the Genius PostgreSQL connection pool.
 * Call this at module load time to warm up the connection pool on Lambda cold start.
 */
export function initGeniusClient(): void {
  getGeniusClient();
}

export async function testConnections(): Promise<{
  postgres: boolean;
  genius: boolean;
}> {
  const [postgres, genius] = await Promise.all([
    getPostgresClient().testConnection(),
    getGeniusClient().testConnection(),
  ]);
  return { postgres, genius };
}

export async function closeConnections(): Promise<void> {
  await Promise.all([postgresClient?.close(), geniusClient?.close()]);
  postgresClient = null;
  geniusClient = null;
}
